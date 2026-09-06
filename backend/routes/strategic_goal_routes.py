import json
from datetime import datetime
from flask import Blueprint, request, jsonify, g
from database import get_db, rows_to_list, row_to_dict
from auth import login_required, roles_required, SUPERVISOR_ROLES
from routes.utils import log_audit
from routes.org_tiers import subtree_unit_ids
from chain import unit_head
from scoring import _activity_score
from routes.program_routes import (
    ACTIVITY_AUTHOR_ROLES,
    _normalize_activity_kpis,
    _validate_goal_link,
    _recalc_progress_from_kpis,
    _propagate_status,
    _propagate_progress,
    _log as _log_activity,
)

bp = Blueprint("strategic_goal_routes", __name__, url_prefix="/api/strategic-goals")


def _unit_activity_forest(db, unit_ids):
    """Rooted program-activity forests for the given teams. Top-level rows are
    the department-set team activities (org_unit_id in unit_ids, no parent);
    every descendant (member drill-down) is attached recursively. Each node
    carries its program + served strategic goal + KPIs."""
    if not unit_ids:
        return []
    marks = ",".join("?" * len(unit_ids))
    select = (
        "SELECT a.*, e.full_name AS assignee_name, p.name AS program_name, "
        "sg.title AS strategic_goal_title, sg.scope AS strategic_goal_scope "
        "FROM program_activities a "
        "LEFT JOIN employees e ON e.id=a.assignee_id "
        "LEFT JOIN programs p ON p.id=a.program_id "
        "LEFT JOIN strategic_goals sg ON sg.id=a.strategic_goal_id "
    )
    rows = rows_to_list(db.execute(select + f"WHERE a.org_unit_id IN ({marks}) ORDER BY a.id",
                                   (*unit_ids,)).fetchall())

    # Descend from everything we have so far, skipping rows already captured
    # (member tasks inherit the team's org_unit_id, so the first query already
    # contains most of the tree).
    seen = {r["id"] for r in rows}
    frontier = [r["id"] for r in rows]
    while True:
        fmarks = ",".join("?" * len(frontier))
        kids = rows_to_list(db.execute(
            select + f"WHERE a.parent_id IN ({fmarks}) ORDER BY a.id",
            (*frontier,),
        ).fetchall())
        new_kids = [k for k in kids if k["id"] not in seen]
        if not new_kids:
            break
        rows.extend(new_kids)
        seen.update(k["id"] for k in new_kids)
        frontier = [k["id"] for k in new_kids]

    if not rows:
        return []
    all_ids = list({r["id"] for r in rows})
    kpis = rows_to_list(db.execute(
        "SELECT * FROM activity_kpis WHERE activity_id IN ({}) ORDER BY id".format(
            ",".join("?" * len(all_ids))),
        (*all_ids,),
    ).fetchall())
    kpi_map = {}
    for k in kpis:
        kpi_map.setdefault(k["activity_id"], []).append(k)

    node_map = {}
    for r in rows:
        node_map[r["id"]] = {**r, "kpis": kpi_map.get(r["id"], []), "children": []}
    roots = []
    for r in rows:
        n = node_map[r["id"]]
        if r["parent_id"] and r["parent_id"] in node_map:
            node_map[r["parent_id"]]["children"].append(n)
        else:
            roots.append(n)
    return roots

# The planning cascade is authored strictly by the owning actor for each level.
#   executive   -> annual        (grand plan)
#   director   -> quarterly     (synthesize annuals into directorate quarters)
#   dept_head  -> quarterly/team (assign a quarterly plan per team under their dept)
#   team_leader-> individual    (synthesize a team/quarterly plan into member tasks)
# Admin/executives are NOT cascade actors: they plan/review only.
AUTHOR_SCOPES = {
    "executive": ("annual",),
    "director": ("quarterly",),
    "dept_head": ("quarterly", "team"),
    "team_leader": ("individual",),
}
CHILD_SCOPE = {"annual": "quarterly", "quarterly": "team", "team": "individual"}


def _unit_level(db, unit_id):
    if not unit_id:
        return None
    row = db.execute(
        "SELECT out.level_order FROM departments d "
        "LEFT JOIN org_unit_types out ON out.id = d.unit_type_id WHERE d.id=?",
        (unit_id,),
    ).fetchone()
    return row["level_order"] if row else None


def _employee_unit(db, employee_id):
    row = db.execute(
        "SELECT department_id FROM employees WHERE id=?", (employee_id,)
    ).fetchone()
    return row["department_id"] if row else None


def _goal_in_scope(db, employee_id, role, goal):
    """Match the visibility rules used by the strategic-goal list endpoint."""
    if role == "admin":
        return True
    if goal["scope"] in ("annual", "quarterly"):
        return True
    my_unit = _employee_unit(db, employee_id)
    if not my_unit:
        return goal["assigned_to_id"] == employee_id or goal["owner_id"] == employee_id
    return (
        goal["org_unit_id"] in subtree_unit_ids(db, my_unit)
        or goal["assigned_to_id"] == employee_id
        or goal["owner_id"] == employee_id
    )


def _ancestor_units(db, unit_id):
    """All ancestor unit ids (including `unit_id` itself), bottom-up."""
    out = []
    seen = set()
    cur = unit_id
    while cur is not None and cur not in seen:
        seen.add(cur)
        out.append(cur)
        row = db.execute(
            "SELECT parent_id FROM departments WHERE id=?", (cur,)
        ).fetchone()
        cur = row["parent_id"] if row else None
    return out


def _team_head_id(db, unit_id):
    head = unit_head(unit_id, db=db)
    return head["id"] if head else None


def _attach_program_names(db, goal_rows):
    """Fill program_name for any goal rows linked to a program."""
    ids = {r.get("program_id") for r in goal_rows if r.get("program_id")}
    names = {}
    if ids:
        marks = ",".join("?" * len(ids))
        for row in db.execute(
            f"SELECT id, name FROM programs WHERE id IN ({marks})", (*ids,)
        ).fetchall():
            names[row["id"]] = row["name"]
    for r in goal_rows:
        r["program_name"] = names.get(r.get("program_id"))
    return goal_rows


KPI_TYPES = ("percentage", "numeric", "milestone")
KPI_DIRECTIONS = ("higher_is_better", "lower_is_better", "target_is_best")


def _normalize_kpis(kpis):
    """Validate + normalize a KPI payload. Returns (list, err) where err is
    (status, msg) when the payload is rejected."""
    if kpis is None:
        kpis = []
    if not isinstance(kpis, list):
        return [], (400, "kpis must be an array")
    out = []
    for i, k in enumerate(kpis):
        if not isinstance(k, dict):
            return [], (400, f"kpis[{i}] must be an object")
        name = (k.get("name") or "").strip()
        if not name:
            return [], (400, f"kpis[{i}]: name is required")
        kpi_type = k.get("kpi_type") or "numeric"
        if kpi_type not in KPI_TYPES:
            return [], (400, f"kpis[{i}]: kpi_type must be one of {', '.join(KPI_TYPES)}")
        direction = k.get("direction") or "higher_is_better"
        if direction not in KPI_DIRECTIONS:
            return [], (400, f"kpis[{i}]: direction must be one of {', '.join(KPI_DIRECTIONS)}")
        try:
            target_value = (float(k["target_value"])
                            if k.get("target_value") is not None else None)
        except (TypeError, ValueError):
            return [], (400, f"kpis[{i}]: target_value must be a number")
        try:
            weight = float(k.get("weight", 1))
        except (TypeError, ValueError):
            return [], (400, f"kpis[{i}]: weight must be a number")
        out.append({
            "name": name,
            "kpi_type": kpi_type,
            "target_value": target_value,
            "unit": (k.get("unit") or "").strip() or None,
            "weight": weight,
            "direction": direction,
        })
    return out, None


def _insert_kpis(db, goal_id, kpis):
    for k in kpis:
        db.execute(
            "INSERT INTO strategic_goal_kpis (strategic_goal_id, name, kpi_type, "
            "target_value, unit, weight, direction) VALUES (?,?,?,?,?,?,?)",
            (goal_id, k["name"], k["kpi_type"], k["target_value"], k["unit"],
             k["weight"], k["direction"]),
        )


def _kpis_for_goals(db, goal_ids):
    """{goal_id: [kpi dict]}; every requested id gets a (possibly empty) list."""
    out = {gid: [] for gid in goal_ids}
    if not goal_ids:
        return out
    marks = ",".join("?" * len(goal_ids))
    for r in db.execute(
        f"SELECT * FROM strategic_goal_kpis WHERE strategic_goal_id IN ({marks}) "
        "ORDER BY id",
        (*goal_ids,),
    ).fetchall():
        out.setdefault(r["strategic_goal_id"], []).append(dict(r))
    return out


def _kpi_achievement(kpis_by_goal):
    """Weighted, direction-aware achievement percentage per goal from its KPIs.

    Only goals with at least one measurable KPI (target + actual set) produce a
    figure; milestones count as achieved when actual meets target."""
    out = {}
    for goal_id, kpis in kpis_by_goal.items():
        weighted = 0.0
        total_w = 0.0
        for k in kpis:
            target = k["target_value"]
            actual = k["actual_value"]
            if target is None or actual is None:
                continue
            if k["kpi_type"] == "milestone":
                ratio = 1.0 if float(actual) >= float(target) else 0.0
            elif k["direction"] == "higher_is_better":
                ratio = float(actual) / float(target)
            elif k["direction"] == "lower_is_better":
                ratio = float(target) / float(actual) if actual else 0.0
            else:  # target_is_best
                ratio = max(0.0, 1.0 - abs(float(actual) - float(target)) /
                            max(abs(float(target)), 1.0))
            ratio = max(0.0, min(1.0, ratio))
            w = k["weight"] or 1
            weighted += ratio * w
            total_w += w
        if total_w:
            out[goal_id] = round(weighted * 100.0 / total_w)
    return out


def _linked_activity_achievement(db, goal_ids):
    """Recursive achievement of the activities linked to each goal.

    Assessment chain: member tasks -> activities -> dept plans -> programs.
    A goal's progress is the weighted achievement of its linked activity ROOTS
    (linked activities whose parent is not itself a linked activity), where
    each root's score recursively rolls up its member drill-downs via
    scoring._activity_score. Only goals with measurable linked activities get a
    value -- those put the activity rollup in charge of the plan's progress."""
    if not goal_ids:
        return {}
    marks = ",".join("?" * len(goal_ids))
    rows = rows_to_list(db.execute(
        f"SELECT id, parent_id, strategic_goal_id gid, weight FROM program_activities "
        f"WHERE strategic_goal_id IN ({marks}) ORDER BY id",
        (*goal_ids,),
    ).fetchall())

    per_goal = {}
    for r in rows:
        per_goal.setdefault(r["gid"], []).append(r)

    out = {}
    for gid, acts in per_goal.items():
        ids_in_goal = {a["id"] for a in acts}
        roots = [a for a in acts
                 if a["parent_id"] is None or a["parent_id"] not in ids_in_goal]
        total_w = 0.0
        weighted = 0.0
        for a in roots:
            score = _activity_score(db, a["id"])
            if score is None:
                continue
            w = a["weight"] or 1
            weighted += score * w
            total_w += w
        if total_w:
            out[gid] = round(weighted / total_w)
    return out


def _computed_goal_progress(db, goal_ids):
    """Leaf goal progress along the assessment chain
    member tasks -> activities -> dept plans -> programs.

    A goal's linked activities are the authoritative measure of its progress:
    their KPI achievement (recursively rolled up from member drill-downs) drives
    the goal outright when present. Goals without linked measurable activities
    fall back to their weekly-task done-rate; goals with neither input are left
    out (callers fall back to stored progress_pct)."""
    if not goal_ids:
        return {}
    activity_pct = _linked_activity_achievement(db, goal_ids)
    marks = ",".join("?" * len(goal_ids))
    rows = db.execute(
        f"SELECT strategic_goal_id gid, COUNT(*) total, "
        f"SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) done "
        f"FROM weekly_tasks WHERE strategic_goal_id IN ({marks}) "
        f"GROUP BY strategic_goal_id",
        (*goal_ids,),
    ).fetchall()
    out = {}
    for r in rows:
        total = r["total"] or 0
        if total:
            out[r["gid"]] = round((r["done"] or 0) * 100.0 / total)
    for gid in goal_ids:
        act = activity_pct.get(gid)
        if act is not None:
            out[gid] = act
    return out


def _rollup_progress(db, goal_id, memo=None):
    """Recursive progress for a goal: non-leaf goals average their children's
    progress down to the leaf, where linked activity achievement (member tasks
    rolled into activities) drives the plan, falling back to weekly-task
    execution (see _computed_goal_progress)."""
    if memo is None:
        memo = {}
    if goal_id in memo:
        return memo[goal_id]
    kids = rows_to_list(db.execute(
        "SELECT id FROM strategic_goals "
        "WHERE parent_id=? AND status != 'cancelled'",
        (goal_id,),
    ).fetchall())
    computed = _computed_goal_progress(db, [goal_id])
    if not kids:
        val = computed.get(goal_id)
        if val is None:
            row = db.execute(
                "SELECT progress_pct FROM strategic_goals WHERE id=?", (goal_id,)
            ).fetchone()
            val = round(row["progress_pct"] or 0) if row else 0
        memo[goal_id] = val
        return val
    vals = [_rollup_progress(db, k["id"], memo) for k in kids]
    out = round(sum(vals) / len(vals)) if vals else 0
    memo[goal_id] = out
    return out


def _goal_activity_contributions(db, goal_ids):
    """{goal_id: [linked activities]} for surfacing the assessment sources."""
    out = {gid: [] for gid in goal_ids}
    if not goal_ids:
        return out
    marks = ",".join("?" * len(goal_ids))
    for r in db.execute(
        f"SELECT a.id, a.title, a.progress_pct, a.parent_id, "
        f"a.strategic_goal_id gid, pr.name AS program_name "
        f"FROM program_activities a "
        f"LEFT JOIN programs pr ON pr.id = a.program_id "
        f"WHERE a.strategic_goal_id IN ({marks}) ORDER BY a.id",
        (*goal_ids,),
    ).fetchall():
        out.setdefault(r["gid"], []).append(dict(r))
    return out


def _merged_progress(sg_row, computed):
    """Resolve progress: prefer weekly-derived (leaf), else stored value."""
    pct = computed.get(sg_row["id"])
    if pct is None:
        pct = sg_row["progress_pct"] or 0
    return round(pct)


def _children_progress_map(db, parent_ids):
    """Cascade rollup progress for each parent goal id: the average of its
    immediate children's progress (weekly-derived, else stored)."""
    out = {}
    if not parent_ids:
        return out
    marks = ",".join("?" * len(parent_ids))
    kids = db.execute(
        f"SELECT id, parent_id, progress_pct FROM strategic_goals "
        f"WHERE parent_id IN ({marks})",
        (*parent_ids,),
    ).fetchall()
    kid_ids = [k["id"] for k in kids]
    computed = _computed_goal_progress(db, kid_ids)
    acc = {}
    for k in kids:
        pct = computed.get(k["id"])
        if pct is None:
            pct = k["progress_pct"] or 0
        acc.setdefault(k["parent_id"], []).append(pct)
    for pid, vals in acc.items():
        out[pid] = round(sum(vals) / len(vals))
    return out


def _validate_org_for_scope(db, uid, scope, org_unit_id, assigned_to_id, parent):
    """Resolve + validate org_unit_id and assigned_to_id for an authored goal.

    Returns (org_unit_id, assigned_to_id, ok, err) where err is (status, msg)
    when ok is False.
    """
    my_unit = _employee_unit(db, uid)

    if scope == "annual":
        return None, None, True, None

    if scope == "quarterly":
        level = _unit_level(db, my_unit)
        if level == 1:
            # Director: one quarterly plan per directorate.
            org_unit_id = org_unit_id or my_unit
            if org_unit_id != my_unit:
                return None, None, False, (
                    403, "a quarterly plan must belong to your own directorate")
            assigned_to_id = assigned_to_id or uid
            if assigned_to_id != uid:
                target = _employee_unit(db, assigned_to_id)
                if not target or target not in subtree_unit_ids(db, my_unit):
                    return None, None, False, (
                        403, "quarterly assignee must be inside your directorate")
            return org_unit_id, assigned_to_id, True, None

        if level == 2:
            # Department head: assign a quarterly plan to each team under them.
            if not parent or parent["scope"] != "annual":
                return None, None, False, (
                    400, "a department's quarterly plan must hang under an annual goal")
            team_id = org_unit_id
            if not team_id:
                return None, None, False, (400, "org_unit_id (target team) is required")
            if _unit_level(db, team_id) != 3:
                return None, None, False, (
                    400, "org_unit_id must be one of your team-level units")
            if team_id not in subtree_unit_ids(db, my_unit):
                return None, None, False, (
                    403, "you can only assign quarterly plans to your own teams")
            if assigned_to_id is None:
                assigned_to_id = _team_head_id(db, team_id)
            else:
                target = _employee_unit(db, assigned_to_id)
                if not target or target != team_id:
                    return None, None, False, (
                        403, "the quarterly assignee must be the team's leader")
            return team_id, assigned_to_id, True, None

        return None, None, False, (
            403, "only a director or department head can author quarterly plans")

    if scope == "team":
        level = _unit_level(db, my_unit)
        if level != 2:
            return None, None, False, (
                403, "only a department head can author team plans")
        if parent and parent["org_unit_id"]:
            # The quarterly anchor is either the directorate's own quarterly
            # (above the department) or a dept-head quarterly assigned straight
            # to this target team.
            if (parent["org_unit_id"] != org_unit_id
                    and parent["org_unit_id"] not in _ancestor_units(db, my_unit)):
                return None, None, False, (
                    403, "the quarterly anchor must be above your department or belong to the target team")
        if not org_unit_id:
            return None, None, False, (400, "org_unit_id (target team) is required")
        if _unit_level(db, org_unit_id) != 3:
            return None, None, False, (
                400, "org_unit_id must be a team-level unit")
        if org_unit_id not in subtree_unit_ids(db, my_unit):
            return None, None, False, (
                403, "the target team must be inside your department")
        if assigned_to_id is None:
            assigned_to_id = _team_head_id(db, org_unit_id)
        else:
            target = _employee_unit(db, assigned_to_id)
            if not target or target != org_unit_id:
                return None, None, False, (
                    403, "the assignee must work in the target team")
        return org_unit_id, assigned_to_id, True, None

    if scope == "individual":
        level = _unit_level(db, my_unit)
        if level != 3:
            return None, None, False, (
                403, "only a team leader can author individual tasks")
        org_unit_id = org_unit_id or my_unit
        if org_unit_id != my_unit:
            return None, None, False, (
                403, "individual tasks must belong to your own team")
        if parent and parent["org_unit_id"]:
            if parent["org_unit_id"] != my_unit:
                return None, None, False, (
                    403, "the source team plan must belong to your team")
        if not assigned_to_id:
            return None, None, False, (400, "assigned_to_id (member) is required")
        target = _employee_unit(db, assigned_to_id)
        if not target or target != my_unit:
            return None, None, False, (
                403, "the assignee must be a member of your team")
        return org_unit_id, assigned_to_id, True, None

    return None, None, False, (400, "invalid scope")


def _child_allowed(db, uid, parent, scope):
    """Whether `scope` may be authored under `parent`. Beyond the fixed
    annual→quarterly→team→individual chain, a team leader may synthesize
    individual member tasks directly under the quarterly plan assigned to
    their own team."""
    if CHILD_SCOPE.get(parent["scope"]) == scope:
        return True
    if parent["scope"] == "quarterly" and scope == "individual":
        my_unit = _employee_unit(db, uid)
        return my_unit is not None and parent["org_unit_id"] == my_unit \
            and _unit_level(db, my_unit) == 3
    return False


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------
@bp.get("")
@login_required
def list_strategic_goals():
    db = get_db()
    try:
        uid = g.user.get("employee_id")
        role = g.user.get("role")

        if role == "admin":
            goals = rows_to_list(db.execute(
                "SELECT sg.*, e.full_name AS owner_name, a.full_name AS assigned_name, "
                "d.name AS org_unit_name "
                "FROM strategic_goals sg "
                "LEFT JOIN employees e ON e.id = sg.owner_id "
                "LEFT JOIN employees a ON a.id = sg.assigned_to_id "
                "LEFT JOIN departments d ON d.id = sg.org_unit_id "
                "ORDER BY sg.year DESC, sg.quarter DESC, sg.scope DESC"
            ).fetchall())
        elif role in ("executive", "director"):
            # Executives and directors stop at the department: annual + quarterly.
            where = "sg.scope IN ('annual', 'quarterly')"
            params = []
            if role == "director":
                my_unit = _employee_unit(db, uid)
                unit_ids = subtree_unit_ids(db, my_unit) if my_unit else []
                if unit_ids:
                    marks = ",".join("?" * len(unit_ids))
                    where += (f" AND (sg.scope='annual' OR sg.org_unit_id IN ({marks}) "
                              f"OR sg.assigned_to_id=? OR sg.owner_id=?)")
                    params = [*unit_ids, uid, uid]
                else:
                    where += " AND (sg.scope='annual' OR sg.assigned_to_id=? OR sg.owner_id=?)"
                    params = [uid, uid]
            goals = rows_to_list(db.execute(
                "SELECT sg.*, e.full_name AS owner_name, a.full_name AS assigned_name, "
                "d.name AS org_unit_name "
                "FROM strategic_goals sg "
                "LEFT JOIN employees e ON e.id = sg.owner_id "
                "LEFT JOIN employees a ON a.id = sg.assigned_to_id "
                "LEFT JOIN departments d ON d.id = sg.org_unit_id "
                f"WHERE {where} "
                "ORDER BY sg.year DESC, sg.quarter DESC, sg.scope DESC",
                params,
            ).fetchall())
        elif role in SUPERVISOR_ROLES:
            my_unit = _employee_unit(db, uid)
            unit_ids = subtree_unit_ids(db, my_unit) if my_unit else []
            if not unit_ids:
                sub_ids = [uid]
            else:
                sub_ids = [r["id"] for r in db.execute(
                    f"SELECT id FROM employees WHERE department_id IN ({','.join('?' * len(unit_ids))})",
                    (*unit_ids,)
                ).fetchall()]
            if uid not in sub_ids:
                sub_ids.append(uid)
            goals = rows_to_list(db.execute(
                "SELECT sg.*, e.full_name AS owner_name, a.full_name AS assigned_name, "
                "d.name AS org_unit_name "
                "FROM strategic_goals sg "
                "LEFT JOIN employees e ON e.id = sg.owner_id "
                "LEFT JOIN employees a ON a.id = sg.assigned_to_id "
                "LEFT JOIN departments d ON d.id = sg.org_unit_id "
                "WHERE sg.assigned_to_id IN ({}) OR sg.owner_id = ? OR sg.scope IN ('annual', 'quarterly') "
                "ORDER BY sg.year DESC, sg.quarter DESC, sg.scope DESC".format(
                    ",".join("?" * len(sub_ids))),
                (*sub_ids, uid)
            ).fetchall())
        else:
            goals = rows_to_list(db.execute(
                "SELECT sg.*, e.full_name AS owner_name, a.full_name AS assigned_name, "
                "d.name AS org_unit_name "
                "FROM strategic_goals sg "
                "LEFT JOIN employees e ON e.id = sg.owner_id "
                "LEFT JOIN employees a ON a.id = sg.assigned_to_id "
                "LEFT JOIN departments d ON d.id = sg.org_unit_id "
"WHERE sg.assigned_to_id = ? OR sg.scope IN ('annual', 'quarterly') "
                "ORDER BY sg.year DESC, sg.quarter DESC",
                (uid,)
            ).fetchall())

        _attach_program_names(db, goals)
        return jsonify(goals)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Create (cascade authorship)
# ---------------------------------------------------------------------------
@bp.post("")
@login_required
def create_strategic_goal():
    data = request.get_json(force=True) or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "title is required"}), 400

    scope = data.get("scope", "annual")
    if scope not in ("annual", "quarterly", "team", "individual"):
        return jsonify({"error": "invalid scope"}), 400

    db = get_db()
    try:
        uid = g.user.get("employee_id")
        role = g.user.get("role")

        allowed = AUTHOR_SCOPES.get(role, ())
        if scope not in allowed:
            if not allowed:
                return jsonify({"error": f"forbidden: {role} cannot author goals"}), 403
            return jsonify({"error": (
                f"forbidden: only {role} can author {', '.join(sorted(allowed))} goals")}), 403

        parent_id = data.get("parent_id")
        parent = None
        if parent_id:
            parent = db.execute(
                "SELECT * FROM strategic_goals WHERE id=?", (parent_id,)
            ).fetchone()
            if not parent:
                return jsonify({"error": "Parent goal not found"}), 404

        if scope == "annual":
            if parent is not None:
                return jsonify({"error": "an annual goal cannot have a parent"}), 400
        else:
            if parent is None:
                return jsonify({"error": f"{scope} goals require a parent goal"}), 400
            if not _child_allowed(db, uid, parent, scope):
                return jsonify({"error": (
                    f"Cannot create {scope} goal under {parent['scope']} goal")}), 400

        org_unit_id, assigned_to_id, ok, err = _validate_org_for_scope(
            db, uid, scope, data.get("org_unit_id"), data.get("assigned_to_id"), parent)
        if not ok:
            return jsonify({"error": err[1]}), err[0]

        kpis, kpi_err = _normalize_kpis(data.get("kpis"))
        if kpi_err:
            return jsonify({"error": kpi_err[1]}), kpi_err[0]
        if scope == "individual" and not kpis:
            return jsonify({"error": (
                "individual (member) tasks require at least one KPI")}), 400

        program_id = data.get("program_id")
        if program_id is not None:
            if scope != "annual":
                return jsonify({"error": (
                    "only annual (grand) goals can be coined from a program")}), 400
            if not db.execute("SELECT id FROM programs WHERE id=?", (program_id,)).fetchone():
                return jsonify({"error": "Linked program not found"}), 400
        # Grand plan linkage cascades down the goal tree.
        if parent is not None and program_id is None:
            program_id = parent["program_id"]

        quarter = data.get("quarter")
        year = data.get("year")
        cycle_id = data.get("cycle_id")
        if parent is not None:
            if not quarter:
                quarter = parent["quarter"]
            if not year:
                year = parent["year"]
            if not cycle_id:
                cycle_id = parent["cycle_id"]
        if scope == "annual" and not year:
            year = datetime.now().year

        cur = db.execute(
            "INSERT INTO strategic_goals (parent_id, title, description, scope, owner_id, "
            "assigned_to_id, org_unit_id, cycle_id, quarter, year, program_id, status) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (parent_id, title, data.get("description"), scope, uid,
             assigned_to_id, org_unit_id, cycle_id, quarter, year,
             program_id, data.get("status", "draft"))
        )
        goal_id = cur.lastrowid

        _insert_kpis(db, goal_id, kpis)

        log_audit(db, "strategic_goal", goal_id, "create", new_value=data)
        db.commit()

        return jsonify({"id": goal_id}), 201
    finally:
        db.close()


@bp.get("/<int:goal_id>")
@login_required
def get_strategic_goal(goal_id):
    db = get_db()
    try:
        goal = row_to_dict(db.execute(
            "SELECT sg.*, e.full_name AS owner_name, a.full_name AS assigned_name, "
            "d.name AS org_unit_name "
            "FROM strategic_goals sg "
            "LEFT JOIN employees e ON e.id = sg.owner_id "
            "LEFT JOIN employees a ON a.id = sg.assigned_to_id "
            "LEFT JOIN departments d ON d.id = sg.org_unit_id "
            "WHERE sg.id=?", (goal_id,)
        ).fetchone())

        if not goal:
            return jsonify({"error": "Not found"}), 404
        if not _goal_in_scope(db, g.user.get("employee_id"), g.user.get("role"), goal):
            return jsonify({"error": "Forbidden"}), 403

        children = rows_to_list(db.execute(
            "SELECT sg.*, e.full_name AS owner_name, a.full_name AS assigned_name "
            "FROM strategic_goals sg "
            "LEFT JOIN employees e ON e.id = sg.owner_id "
            "LEFT JOIN employees a ON a.id = sg.assigned_to_id "
            "WHERE sg.parent_id=? ORDER BY sg.scope, sg.quarter",
            (goal_id,)
        ).fetchall())

        parent_chain = []
        current = goal
        while current.get("parent_id"):
            parent = row_to_dict(db.execute(
                "SELECT id, title, scope, parent_id FROM strategic_goals WHERE id=?",
                (current["parent_id"],)
            ).fetchone())
            if not parent:
                break
            parent_chain.append(parent)
            current = parent

        _attach_program_names(db, [goal])
        kpis = _kpis_for_goals(db, [goal_id])
        achievement = _kpi_achievement(kpis)
        contributions = _goal_activity_contributions(db, [goal_id])
        goal["progress_pct"] = _rollup_progress(db, goal_id)
        return jsonify({**goal, "children": children, "parent_chain": parent_chain,
                        "kpis": kpis[goal_id], "kpi_pct": achievement.get(goal_id),
                        "activity_contributions": contributions[goal_id]})
    finally:
        db.close()


@bp.put("/<int:goal_id>")
@login_required
def update_strategic_goal(goal_id):
    data = request.get_json(force=True) or {}
    db = get_db()
    try:
        goal = row_to_dict(db.execute(
            "SELECT * FROM strategic_goals WHERE id=?", (goal_id,)
        ).fetchone())

        if not goal:
            return jsonify({"error": "Not found"}), 404

        uid = g.user.get("employee_id")

        # Only the goal's owner (its cascade author) can update it.
        if goal["owner_id"] != uid:
            return jsonify({"error": "Forbidden"}), 403

        allowed_fields = {"title", "description", "status", "progress_pct", "assigned_to_id"}
        updates = {k: v for k, v in data.items() if k in allowed_fields}

        if ("assigned_to_id" in updates
                and updates["assigned_to_id"] != goal["assigned_to_id"]):
            _, _, ok, err = _validate_org_for_scope(
                db, uid, goal["scope"], goal["org_unit_id"],
                updates["assigned_to_id"], None)
            if not ok:
                return jsonify({"error": err[1]}), err[0]

        if updates:
            db.execute(
                "UPDATE strategic_goals SET {} WHERE id=?".format(
                    ", ".join(f"{k}=?" for k in updates)),
                (*updates.values(), goal_id)
            )
            log_audit(db, "strategic_goal", goal_id, "update",
                     old_value=goal, new_value=updates)
            db.commit()

        return jsonify({"ok": True})
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Plan-linked activities: a department's plan (strategic goal) is where its
# activities hang -- the program is inherited from the plan's cascade chain,
# so dept-level work never needs to pick a program.
# ---------------------------------------------------------------------------
@bp.post("/<int:goal_id>/activities")
@login_required
def create_plan_activity(goal_id):
    """Add an activity to a plan.

    Dept heads set team activities on their own quarterly/team plans (assigned
    to a team in the department). Team leaders break a team activity down into
    member tasks through the same endpoint by passing parent_id. The activity's
    program_id is inherited from the linked plan (NULL when the grand plan was
    not coined from a program)."""
    data = request.get_json(force=True) or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "title required"}), 400

    db = get_db()
    try:
        goal = db.execute(
            "SELECT id, title, scope, status, program_id, org_unit_id "
            "FROM strategic_goals WHERE id=?", (goal_id,)
        ).fetchone()
        if not goal:
            return jsonify({"error": "Plan not found"}), 404
        if goal["status"] == "cancelled":
            return jsonify({"error": "cancelled plans cannot take activities"}), 400

        role = g.user.get("role")
        me = g.user["employee_id"]
        if role not in ACTIVITY_AUTHOR_ROLES:
            return jsonify({"error": (
                "forbidden: only departments and team leaders author activities")}), 403
        my_unit = _employee_unit(db, me)

        parent_id = data.get("parent_id")
        org_unit_id = data.get("org_unit_id")
        assignee_id = data.get("assignee_id")

        if role == "team_leader":
            # Drill-down: leaders break a team activity into member tasks.
            if not parent_id:
                return jsonify({
                    "error": "team leaders can only break a team activity into member tasks"}), 403
            parent = db.execute(
                "SELECT id, parent_id, org_unit_id, strategic_goal_id "
                "FROM program_activities WHERE id=?", (parent_id,)
            ).fetchone()
            if not parent or not parent["org_unit_id"] \
                    or parent["org_unit_id"] != my_unit or _unit_level(db, my_unit) != 3:
                return jsonify({"error": "you can only break down your own team's activities"}), 403
            if parent["strategic_goal_id"] != goal_id:
                return jsonify({"error": (
                    "a member task must stay in its parent team activity's plan")}), 400
            if not assignee_id:
                return jsonify({"error": "assign a member of the team"}), 400
            if _employee_unit(db, assignee_id) != my_unit:
                return jsonify({"error": "the assignee must be a member of your team"}), 403
            org_unit_id = parent["org_unit_id"]
        else:
            # Dept head / admin: set an activity for a team under a plan.
            if parent_id:
                parent = db.execute(
                    "SELECT id, org_unit_id, strategic_goal_id "
                    "FROM program_activities WHERE id=?", (parent_id,)
                ).fetchone()
                if not parent:
                    return jsonify({"error": "parent activity not found"}), 404
                if parent["strategic_goal_id"] != goal_id:
                    return jsonify({"error": (
                        "a sub-activity must stay in its parent's plan")}), 400
                if parent["org_unit_id"] and org_unit_id not in (None, parent["org_unit_id"]):
                    return jsonify({"error": "a sub-activity must stay in its parent's team"}), 400
                org_unit_id = org_unit_id or parent["org_unit_id"]
            if not org_unit_id:
                return jsonify({"error": "org_unit_id (team) is required"}), 400
            if _unit_level(db, org_unit_id) != 3:
                return jsonify({"error": "activities can only be assigned to team-level units"}), 400
            if role == "dept_head":
                # The plan must be one of the dept-head's own: either authored
                # by them, or sitting on a unit inside (or above) their dept.
                owned = db.execute(
                    "SELECT 1 FROM strategic_goals WHERE id=? AND owner_id=?",
                    (goal_id, me)
                ).fetchone()
                in_scope = bool(owned)
                if not in_scope and my_unit and goal["org_unit_id"]:
                    in_scope = (goal["org_unit_id"] in subtree_unit_ids(db, my_unit)
                                or goal["org_unit_id"] in _ancestor_units(db, my_unit))
                if not in_scope:
                    return jsonify({
                        "error": "you can only add activities to plans in your department"}), 403
                if not my_unit or org_unit_id not in subtree_unit_ids(db, my_unit):
                    return jsonify({
                        "error": "you can only assign activities to teams in your department"}), 403
            if assignee_id and _employee_unit(db, assignee_id) != org_unit_id:
                return jsonify({"error": "the assignee must be a member of the assigned team"}), 403

        ok, err = _validate_goal_link(db, me, role, goal_id, assignee_id, org_unit_id)
        if not ok:
            return jsonify({"error": err[1]}), err[0]

        kpis, kpi_err = _normalize_activity_kpis(data.get("kpis"))
        if kpi_err:
            return jsonify({"error": kpi_err[1]}), kpi_err[0]

        cur = db.execute(
            "INSERT INTO program_activities (program_id, parent_id, title, description, assignee_id, "
            "org_unit_id, start_date, due_date, status, progress_pct, weight, assigned_by, strategic_goal_id) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                goal["program_id"], parent_id, title, data.get("description"),
                assignee_id, org_unit_id, data.get("start_date"), data.get("due_date"),
                data.get("status", "not_started"), data.get("progress_pct", 0),
                data.get("weight", 1), me, goal_id,
            ),
        )
        activity_id = cur.lastrowid
        for k in kpis:
            db.execute(
                "INSERT INTO activity_kpis (activity_id, name, kpi_type, target_value, "
                "actual_value, unit, weight, direction) VALUES (?,?,?,?,?,?,?,?)",
                (activity_id, k["name"], k["kpi_type"], k["target_value"], k["actual_value"],
                 k["unit"], k["weight"], k["direction"]),
            )
        _log_activity(db, "program_activity", activity_id, "create", new_value=data)
        if kpis and any(k["actual_value"] is not None for k in kpis):
            _recalc_progress_from_kpis(db, activity_id)
            _propagate_status(db, activity_id)
        elif parent_id:
            _propagate_progress(db, parent_id)
        db.commit()
        return jsonify({"id": activity_id}), 201
    finally:
        db.close()


@bp.delete("/<int:goal_id>")
@login_required
def delete_strategic_goal(goal_id):
    """Remove a goal the caller authored (or admin), only when it has no
    children yet — lets a dept head retire a mis-drafted quarterly/team plan."""
    db = get_db()
    try:
        goal = row_to_dict(db.execute(
            "SELECT * FROM strategic_goals WHERE id=?", (goal_id,)
        ).fetchone())
        if not goal:
            return jsonify({"error": "Not found"}), 404
        uid = g.user.get("employee_id")
        role = g.user.get("role")
        if role != "admin" and goal["owner_id"] != uid:
            return jsonify({"error": "Forbidden"}), 403
        kids = db.execute(
            "SELECT COUNT(*) c FROM strategic_goals WHERE parent_id=?", (goal_id,)
        ).fetchone()
        if kids["c"]:
            return jsonify({"error": "cannot delete a goal that already has children"}), 400
        db.execute("DELETE FROM strategic_goal_kpis WHERE strategic_goal_id=?", (goal_id,))
        db.execute("DELETE FROM strategic_goals WHERE id=?", (goal_id,))
        log_audit(db, "strategic_goal", goal_id, "delete", old_value=goal)
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Cascade / assign (bulk creation of the next level under a goal)
# ---------------------------------------------------------------------------
@bp.post("/<int:goal_id>/assign")
@login_required
def assign_strategic_goal(goal_id):
    """Cascade: create child goals for the actor who owns the next level.

    annual -> quarterly:  director only
    quarterly -> team:    dept_head only
    team -> individual:   team_leader only
    """
    data = request.get_json(force=True) or {}
    db = get_db()
    try:
        parent = row_to_dict(db.execute(
            "SELECT * FROM strategic_goals WHERE id=?", (goal_id,)
        ).fetchone())

        if not parent:
            return jsonify({"error": "Parent goal not found"}), 404

        uid = g.user.get("employee_id")
        role = g.user.get("role")

        child_scope = CHILD_SCOPE.get(parent["scope"])
        my_unit = _employee_unit(db, uid)
        if parent["scope"] == "quarterly" and my_unit is not None \
                and parent["org_unit_id"] == my_unit and _unit_level(db, my_unit) == 3:
            # Team leader synthesizes the quarterly plan assigned to their own
            # team directly into individual member tasks (weeks & days follow
            # on the weekly-plans side).
            child_scope = "individual"
        if not child_scope:
            return jsonify({"error": f"Cannot cascade {parent['scope']} goals"}), 400

        author = next((r for r, scopes in AUTHOR_SCOPES.items() if child_scope in scopes), None)
        if role != author:
            return jsonify({"error": (
                f"forbidden: only {author} can synthesize {parent['scope']} goals "
                f"into {child_scope} plans")}), 403

        assignments = data.get("assignments", [])
        if not assignments:
            return jsonify({"error": "assignments array is required"}), 400

        created = []
        for item in assignments:
            title = (item.get("title") or "").strip()
            if not title:
                continue

            org_unit_id, assigned_to_id, ok, err = _validate_org_for_scope(
                db, uid, child_scope, item.get("org_unit_id"),
                item.get("assigned_to_id"), parent)
            if not ok:
                return jsonify({"error": err[1]}), err[0]

            kpis, kpi_err = _normalize_kpis(item.get("kpis"))
            if kpi_err:
                return jsonify({"error": kpi_err[1]}), kpi_err[0]
            if child_scope == "individual" and not kpis:
                return jsonify({"error": (
                    f"every member task requires at least one KPI ({title})")}), 400

            quarter = item.get("quarter") or parent["quarter"]
            year = item.get("year") or parent["year"]

            cur = db.execute(
                "INSERT INTO strategic_goals (parent_id, title, description, scope, owner_id, "
                "assigned_to_id, org_unit_id, cycle_id, quarter, year, program_id, status) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (goal_id, title, item.get("description"), child_scope,
                 uid, assigned_to_id, org_unit_id,
                 parent["cycle_id"], quarter, year,
                 parent["program_id"], item.get("status", "draft"))
            )
            _insert_kpis(db, cur.lastrowid, kpis)
            created.append(cur.lastrowid)

        if created:
            log_audit(db, "strategic_goal", goal_id, "cascade",
                     new_value={"children_created": created, "child_scope": child_scope})
        db.commit()

        return jsonify({"created": created, "child_scope": child_scope})
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Strategic-goal KPIs (member tasks must carry at least one)
# ---------------------------------------------------------------------------
@bp.get("/<int:goal_id>/kpis")
@login_required
def list_strategic_goal_kpis(goal_id):
    db = get_db()
    try:
        goal = db.execute(
            "SELECT id, scope, owner_id, assigned_to_id, org_unit_id FROM strategic_goals WHERE id=?", (goal_id,)
        ).fetchone()
        if not goal:
            return jsonify({"error": "Not found"}), 404
        if not _goal_in_scope(db, g.user.get("employee_id"), g.user.get("role"), goal):
            return jsonify({"error": "Forbidden"}), 403
        return jsonify(_kpis_for_goals(db, [goal_id])[goal_id])
    finally:
        db.close()


@bp.post("/<int:goal_id>/kpis")
@login_required
def create_strategic_goal_kpi(goal_id):
    data = request.get_json(force=True) or {}
    kpis, err = _normalize_kpis([data])
    if err:
        return jsonify({"error": err[1]}), err[0]
    db = get_db()
    try:
        goal = db.execute(
            "SELECT id, owner_id FROM strategic_goals WHERE id=?", (goal_id,)
        ).fetchone()
        if not goal:
            return jsonify({"error": "Not found"}), 404
        uid = g.user.get("employee_id")
        role = g.user.get("role")
        if role != "admin" and goal["owner_id"] != uid:
            return jsonify({"error": "Forbidden"}), 403
        cur = db.execute(
            "INSERT INTO strategic_goal_kpis (strategic_goal_id, name, kpi_type, "
            "target_value, unit, weight, direction) VALUES (?,?,?,?,?,?,?)",
            (goal_id, kpis[0]["name"], kpis[0]["kpi_type"], kpis[0]["target_value"],
             kpis[0]["unit"], kpis[0]["weight"], kpis[0]["direction"]),
        )
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201
    finally:
        db.close()


@bp.put("/kpis/<int:kpi_id>")
@login_required
def update_strategic_goal_kpi(kpi_id):
    data = request.get_json(force=True) or {}
    db = get_db()
    try:
        kpi = db.execute(
            "SELECT * FROM strategic_goal_kpis WHERE id=?", (kpi_id,)
        ).fetchone()
        if not kpi:
            return jsonify({"error": "Not found"}), 404
        goal = db.execute(
            "SELECT owner_id, assigned_to_id, scope FROM strategic_goals WHERE id=?",
            (kpi["strategic_goal_id"],)
        ).fetchone()
        if not goal:
            return jsonify({"error": "Not found"}), 404
        uid = g.user.get("employee_id")
        role = g.user.get("role")
        fields = ["name", "kpi_type", "target_value", "actual_value",
                  "unit", "weight", "direction"]
        if role == "admin" or goal["owner_id"] == uid:
            updates = {f: data[f] for f in fields if f in data}
        else:
            if goal["assigned_to_id"] != uid:
                return jsonify({"error": (
                    "you can only update KPIs on tasks assigned to you")}), 403
            if any(f in data for f in ("name", "kpi_type", "target_value",
                                       "unit", "weight", "direction")):
                return jsonify({"error": "employees can only update actual_value"}), 403
            if "actual_value" not in data:
                return jsonify({"error": "Nothing to update"}), 400
            updates = {"actual_value": data["actual_value"]}
        if not updates:
            return jsonify({"ok": True})
        db.execute(
            "UPDATE strategic_goal_kpis SET {} WHERE id=?".format(
                ", ".join(f"{k}=?" for k in updates)),
            (*updates.values(), kpi_id)
        )
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


@bp.delete("/kpis/<int:kpi_id>")
@login_required
def delete_strategic_goal_kpi(kpi_id):
    db = get_db()
    try:
        kpi = db.execute(
            "SELECT * FROM strategic_goal_kpis WHERE id=?", (kpi_id,)
        ).fetchone()
        if not kpi:
            return jsonify({"error": "Not found"}), 404
        goal = db.execute(
            "SELECT owner_id, scope FROM strategic_goals WHERE id=?",
            (kpi["strategic_goal_id"],)
        ).fetchone()
        if not goal:
            return jsonify({"error": "Not found"}), 404
        uid = g.user.get("employee_id")
        role = g.user.get("role")
        if role != "admin" and goal["owner_id"] != uid:
            return jsonify({"error": "Forbidden"}), 403
        if goal["scope"] == "individual":
            count = db.execute(
                "SELECT COUNT(*) c FROM strategic_goal_kpis WHERE strategic_goal_id=?",
                (kpi["strategic_goal_id"],)
            ).fetchone()["c"]
            if count <= 1:
                return jsonify({"error": (
                    "a member task must keep at least one KPI")}), 400
        db.execute("DELETE FROM strategic_goal_kpis WHERE id=?", (kpi_id,))
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Assigned-to-me (member inbox) + upward breadcrumb
# ---------------------------------------------------------------------------
@bp.get("/assigned")
@login_required
def assigned_goals():
    db = get_db()
    try:
        uid = g.user.get("employee_id")
        rows = rows_to_list(db.execute(
            "SELECT sg.*, e.full_name AS owner_name, d.name AS org_unit_name "
            "FROM strategic_goals sg "
            "LEFT JOIN employees e ON e.id = sg.owner_id "
            "LEFT JOIN departments d ON d.id = sg.org_unit_id "
            "WHERE sg.assigned_to_id=? AND sg.scope='individual' "
            "  AND sg.status != 'cancelled' "
            "ORDER BY sg.year DESC, sg.quarter DESC, sg.id DESC",
            (uid,)
        ).fetchall())

        ids = [r["id"] for r in rows]
        computed = _computed_goal_progress(db, ids)
        kpi_map = _kpis_for_goals(db, ids)
        achievement = _kpi_achievement(kpi_map)

        out = []
        for r in rows:
            chain = []
            current_parent = r["parent_id"]
            while current_parent:
                p = db.execute(
                    "SELECT id, title, scope, parent_id FROM strategic_goals WHERE id=?",
                    (current_parent,)
                ).fetchone()
                if not p:
                    break
                chain.append({"id": p["id"], "title": p["title"], "scope": p["scope"]})
                current_parent = p["parent_id"]
            chain.reverse()
            out.append({
                "id": r["id"],
                "title": r["title"],
                "description": r["description"],
                "scope": r["scope"],
                "status": r["status"],
                "owner_name": r["owner_name"],
                "org_unit_name": r["org_unit_name"],
                "progress_pct": _merged_progress(r, computed),
                "kpis": kpi_map.get(r["id"], []),
                "kpi_pct": achievement.get(r["id"]),
                "breadcrumb": chain,
            })

        return jsonify(out)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Dept-head planner: quarterly anchors + each team's assigned plans (aggregated)
# ---------------------------------------------------------------------------
@bp.get("/department")
@login_required
@roles_required("dept_head")
def department_planning():
    db = get_db()
    try:
        uid = g.user.get("employee_id")
        my_unit = _employee_unit(db, uid)
        if not my_unit:
            return jsonify({"error": "no org unit scope"}), 400

        ancestors = _ancestor_units(db, my_unit)
        quarterlies = rows_to_list(db.execute(
            "SELECT sg.* FROM strategic_goals sg "
            "WHERE sg.scope='quarterly' AND sg.status != 'cancelled' "
            "  AND (sg.org_unit_id IN ({}) OR sg.owner_id = ?) "
            "ORDER BY sg.year DESC, sg.quarter DESC".format(
                ",".join("?" * len(ancestors))),
            (*ancestors, uid)
        ).fetchall())

        annuals = rows_to_list(db.execute(
            "SELECT id, title, year, status FROM strategic_goals "
            "WHERE scope='annual' AND status != 'cancelled' "
            "ORDER BY year DESC, id DESC"
        ).fetchall())

        team_ids = [u for u in subtree_unit_ids(db, my_unit) if _unit_level(db, u) == 3]
        team_nodes = {}
        if team_ids:
            for r in db.execute(
                f"SELECT id, name FROM departments WHERE id IN ({','.join('?' * len(team_ids))})",
                (*team_ids,)
            ).fetchall():
                team_nodes[r["id"]] = r["name"]

        plans = []
        if team_ids:
            plans = rows_to_list(db.execute(
                "SELECT sg.* FROM strategic_goals sg "
                "WHERE sg.scope='team' AND sg.status != 'cancelled' AND sg.org_unit_id IN ({}) "
                "ORDER BY sg.id".format(",".join("?" * len(team_ids))),
                (*team_ids,)
            ).fetchall())

        computed = _computed_goal_progress(db, [p["id"] for p in plans])
        progress_extra = _children_progress_map(db, [p["id"] for p in plans])
        qcomputed = _computed_goal_progress(db, [q["id"] for q in quarterlies])
        qrollup = {q["id"]: _rollup_progress(db, q["id"]) for q in quarterlies}

        plans_by_team = {}
        for p in plans:
            plans_by_team.setdefault(p["org_unit_id"], []).append(p)
        qplans_by_team = {}
        for q in quarterlies:
            qplans_by_team.setdefault(q["org_unit_id"], []).append(q)

        activity_forest = _unit_activity_forest(db, team_ids)
        activities_by_team = {}
        for a in activity_forest:
            activities_by_team.setdefault(a["org_unit_id"], []).append(a)

        def _team_activity_shape(a):
            return {
                "id": a["id"],
                "title": a["title"],
                "description": a["description"],
                "status": a["status"],
                "progress_pct": a["progress_pct"],
                "due_date": a["due_date"],
                "parent_id": a["parent_id"],
                "assignee_id": a["assignee_id"],
                "org_unit_id": a["org_unit_id"],
                "program_id": a["program_id"],
                "program_name": a["program_name"],
                "strategic_goal_id": a["strategic_goal_id"],
                "strategic_goal_title": a["strategic_goal_title"],
                "member_task_count": len(a["children"]),
                "kpis": a["kpis"],
                "children": [{
                    "id": c["id"], "title": c["title"],
                    "assignee_id": c["assignee_id"],
                    "assignee_name": c["assignee_name"],
                    "status": c["status"], "progress_pct": c["progress_pct"],
                } for c in a["children"]],
            }

        teams_out = []
        for tid in sorted(team_nodes):
            dept_plans = plans_by_team.get(tid, [])
            team_qplans = qplans_by_team.get(tid, [])
            teams_out.append({
                "unit_id": tid,
                "unit_name": team_nodes[tid],
                "head_id": _team_head_id(db, tid),
                "quarterly_plans": [{
                    "id": q["id"],
                    "title": q["title"],
                    "status": q["status"],
                    "scope": q["scope"],
                    "description": q["description"],
                    "owner_id": q["owner_id"],
                    "progress_pct": round(qcomputed.get(q["id"], qrollup.get(q["id"], q["progress_pct"] or 0))),
                    "tasks_assigned": db.execute(
                        "SELECT COUNT(*) c FROM strategic_goals WHERE parent_id=?",
                        (q["id"],)
                    ).fetchone()["c"],
                } for q in team_qplans],
                "plans": [{
                    "id": p["id"],
                    "title": p["title"],
                    "status": p["status"],
                    "scope": p["scope"],
                    "description": p["description"],
                    "owner_id": p["owner_id"],
                    "progress_pct": round(
                        computed.get(p["id"], progress_extra.get(p["id"], p["progress_pct"] or 0))),
                    "tasks_assigned": db.execute(
                        "SELECT COUNT(*) c FROM strategic_goals WHERE parent_id=?",
                        (p["id"],)
                    ).fetchone()["c"],
                } for p in dept_plans],
                "activities": [_team_activity_shape(a) for a in activities_by_team.get(tid, [])],
            })

        return jsonify({"annuals": annuals, "quarterlies": quarterlies, "teams": teams_out})
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Team-lead planner: dept-assigned plan + members with their tasks
# ---------------------------------------------------------------------------
@bp.get("/team")
@login_required
@roles_required("team_leader")
def team_planning():
    db = get_db()
    try:
        uid = g.user.get("employee_id")
        my_unit = _employee_unit(db, uid)
        if not my_unit:
            return jsonify({"error": "no org unit scope"}), 400

        plans = rows_to_list(db.execute(
            "SELECT sg.*, d.name AS org_unit_name "
            "FROM strategic_goals sg "
            "LEFT JOIN departments d ON d.id = sg.org_unit_id "
            "WHERE sg.scope='team' AND sg.status != 'cancelled' AND sg.org_unit_id=? "
            "ORDER BY sg.id",
            (my_unit,)
        ).fetchall())

        # Quarterly plans a dept head assigned to this team: the leader's
        # plan to synthesize into member tasks (weeks & days).
        quarterly_plans = rows_to_list(db.execute(
            "SELECT sg.*, d.name AS org_unit_name "
            "FROM strategic_goals sg "
            "LEFT JOIN departments d ON d.id = sg.org_unit_id "
            "WHERE sg.scope='quarterly' AND sg.status != 'cancelled' AND sg.org_unit_id=? "
            "ORDER BY sg.id",
            (my_unit,)
        ).fetchall())

        anchors = []
        for p in plans + quarterly_plans:
            chain = []
            current_parent = p["parent_id"]
            while current_parent:
                pr = db.execute(
                    "SELECT id, title, scope, parent_id FROM strategic_goals WHERE id=?",
                    (current_parent,)
                ).fetchone()
                if not pr:
                    break
                chain.append({"id": pr["id"], "title": pr["title"], "scope": pr["scope"]})
                current_parent = pr["parent_id"]
            chain.reverse()
            anchors.append(chain)

        members = [dict(r) for r in db.execute(
            "SELECT id, full_name, position FROM employees "
            "WHERE employment_status='active' AND department_id=? "
            "ORDER BY full_name",
            (my_unit,)
        ).fetchall()]

        member_tasks = {}
        all_goal_ids = []
        if members:
            marks = ",".join("?" * len(members))
            rows = db.execute(
                "SELECT sg.*, g2.full_name AS owner_name "
                "FROM strategic_goals sg "
                "LEFT JOIN employees g2 ON g2.id = sg.owner_id "
                "WHERE sg.scope='individual' AND sg.status != 'cancelled' "
                "  AND sg.assigned_to_id IN ({}) "
                "ORDER BY sg.id".format(marks),
                (*[m["id"] for m in members],)
            ).fetchall()
            for r in rows:
                member_tasks.setdefault(r["assigned_to_id"], []).append(dict(r))
                all_goal_ids.append(r["id"])

        computed = _computed_goal_progress(db, all_goal_ids)
        kpi_map = _kpis_for_goals(db, all_goal_ids)
        achievement = _kpi_achievement(kpi_map)

        members_out = []
        for m in members:
            tasks = []
            for t in member_tasks.get(m["id"], []):
                tasks.append({
                    "id": t["id"],
                    "title": t["title"],
                    "status": t["status"],
                    "progress_pct": _merged_progress(t, computed),
                    "kpis": kpi_map.get(t["id"], []),
                    "kpi_pct": achievement.get(t["id"]),
                })
            members_out.append({**m, "tasks": tasks})

        return jsonify({"plans": plans, "quarterly_plans": quarterly_plans,
                        "anchors": anchors, "members": members_out,
                        "team_activities": _unit_activity_forest(db, [my_unit])})
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Tree with per-role view windows
# ---------------------------------------------------------------------------
@bp.get("/tree")
@login_required
def strategic_goal_tree():
    """Tree view. Executives and directors stop at the department: their view
    shows annual -> quarterly -> department aggregates, with team/individual
    rows rolled up (never shown)."""
    db = get_db()
    try:
        uid = g.user.get("employee_id")
        role = g.user.get("role")

        if role == "admin":
            all_goals = rows_to_list(db.execute(
                "SELECT sg.*, e.full_name AS owner_name, a.full_name AS assigned_name "
                "FROM strategic_goals sg "
                "LEFT JOIN employees e ON e.id = sg.owner_id "
                "LEFT JOIN employees a ON a.id = sg.assigned_to_id "
                "ORDER BY sg.scope, sg.year, sg.quarter"
            ).fetchall())
            computed = _computed_goal_progress(db, [s["id"] for s in all_goals])
            for s in all_goals:
                s["progress_pct"] = _merged_progress(s, computed)
            _attach_program_names(db, all_goals)
            return jsonify(_build_basic_tree(all_goals))

        if role in ("executive", "director"):
            where = "sg.scope IN ('annual', 'quarterly')"
            params = []
            team_where = "1=1"
            team_params = []
            if role == "director":
                my_unit = _employee_unit(db, uid)
                unit_ids = subtree_unit_ids(db, my_unit) if my_unit else []
                if unit_ids:
                    marks = ",".join("?" * len(unit_ids))
                    where += (f" AND (sg.scope='annual' OR sg.org_unit_id IN ({marks}) "
                              f"OR sg.assigned_to_id=? OR sg.owner_id=?)")
                    params = [*unit_ids, uid, uid]
                    team_where = f"sg.org_unit_id IN ({marks})"
                    team_params = [*unit_ids]

            all_goals = rows_to_list(db.execute(
                "SELECT sg.*, e.full_name AS owner_name, a.full_name AS assigned_name "
                "FROM strategic_goals sg "
                "LEFT JOIN employees e ON e.id = sg.owner_id "
                "LEFT JOIN employees a ON a.id = sg.assigned_to_id "
                f"WHERE {where} ORDER BY sg.scope, sg.year, sg.quarter",
                params
            ).fetchall())

            team_rows = rows_to_list(db.execute(
                f"SELECT sg.* FROM strategic_goals sg WHERE sg.scope='team' AND {team_where}",
                team_params
            ).fetchall())

            _attach_program_names(db, all_goals)
            return jsonify(_build_exec_tree(db, all_goals, team_rows))
        else:
            # Other roles: own + org-wide annual/quarterly (legacy scoped view).
            all_goals = rows_to_list(db.execute(
                "SELECT sg.*, e.full_name AS owner_name, a.full_name AS assigned_name "
                "FROM strategic_goals sg "
                "LEFT JOIN employees e ON e.id = sg.owner_id "
                "LEFT JOIN employees a ON a.id = sg.assigned_to_id "
                "WHERE sg.assigned_to_id = ? OR sg.scope IN ('annual', 'quarterly') "
                "ORDER BY sg.scope, sg.year, sg.quarter",
                (uid,)
            ).fetchall())
            computed = _computed_goal_progress(db, [s["id"] for s in all_goals])
            for s in all_goals:
                s["progress_pct"] = _merged_progress(s, computed)
            _attach_program_names(db, all_goals)
            return jsonify(_build_basic_tree(all_goals))
    finally:
        db.close()


def _build_basic_tree(records):
    by_id = {s["id"]: {**s, "children": []} for s in records}
    roots = []
    for s in records:
        if s["parent_id"] and s["parent_id"] in by_id:
            by_id[s["parent_id"]]["children"].append(by_id[s["id"]])
        else:
            roots.append(by_id[s["id"]])
    return roots


def _build_exec_tree(db, records, team_rows):
    """annual -> quarterly -> department aggregates. Team/individual hidden."""
    unit_map = {}
    if team_rows:
        ids = sorted({t["org_unit_id"] for t in team_rows if t["org_unit_id"]})
        if ids:
            for r in db.execute(
                f"SELECT id, name, parent_id FROM departments WHERE id IN ({','.join('?' * len(ids))})",
                (*ids,)
            ).fetchall():
                unit_map[r["id"]] = dict(r)

    team_ids = [t["id"] for t in team_rows]
    computed = _computed_goal_progress(db, team_ids)
    progress_extra = _children_progress_map(db, team_ids)

    agg = {}
    for t in team_rows:
        tu = unit_map.get(t["org_unit_id"])
        if not tu or tu["parent_id"] is None:
            continue
        dept_id = tu["parent_id"]
        qid = t["parent_id"]
        if qid is None:
            continue
        prog = computed.get(t["id"], progress_extra.get(t["id"], 0))
        agg.setdefault((qid, dept_id), []).append(prog)

    if not records:
        return []

    by_id = {}
    for s in records:
        by_id[s["id"]] = {**s, "children": []}

    roots = []
    for s in records:
        if s["parent_id"] and s["parent_id"] in by_id:
            by_id[s["parent_id"]]["children"].append(by_id[s["id"]])
        else:
            roots.append(by_id[s["id"]])

    # synthetic department nodes under their quarterly
    for (qid, dept_id), progs in agg.items():
        if qid not in by_id:
            continue
        name = db.execute(
            "SELECT name FROM departments WHERE id=?", (dept_id,)
        ).fetchone()
        if not name:
            continue
        total = len(progs) or 1
        node = {
            "id": -(qid * 1000 + dept_id),
            "parent_id": qid,
            "title": name["name"],
            "description": "Department aggregate",
            "scope": "department",
            "status": "active",
            "owner_id": None,
            "owner_name": None,
            "assigned_name": None,
            "org_unit_name": None,
            "progress_pct": round(sum(progs) / total),
            "children": [],
        }
        by_id[qid]["children"].append(node)

    return roots

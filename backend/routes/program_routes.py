import json

from flask import Blueprint, request, jsonify, g

from database import get_db, rows_to_list, row_to_dict
from auth import login_required, roles_required, can_view_employee, SUPERVISOR_ROLES
from scoring import _activity_score, compute_activity_kpi_score
from routes.org_tiers import subtree_unit_ids

bp = Blueprint("program_routes", __name__, url_prefix="/api/programs")

MAX_ACTIVITY_DEPTH = 5

# Only departments set activities (assigned to teams); team leaders break team
# activities into member tasks. Executives author programs only.
ACTIVITY_AUTHOR_ROLES = ("admin", "dept_head", "team_leader")


# ---- Helpers ----

def _log(db, entity_type, entity_id, action, old_value=None, new_value=None):
    db.execute(
        "INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value, changed_by) "
        "VALUES (?,?,?,?,?,?)",
        (entity_type, entity_id, action, json.dumps(old_value, default=str) if old_value else None,
         json.dumps(new_value, default=str) if new_value else None, g.user.get("username", "system")),
    )


def _get_depth(db, activity_id):
    depth = 0
    current = activity_id
    while current is not None:
        row = db.execute("SELECT parent_id FROM program_activities WHERE id=?", (current,)).fetchone()
        if not row or row["parent_id"] is None:
            break
        current = row["parent_id"]
        depth += 1
    return depth


def _validate_parent(db, program_id, parent_id, exclude_activity_id=None):
    if parent_id is None:
        return
    if parent_id == exclude_activity_id:
        raise ValueError("A activity cannot be its own parent")
    parent = db.execute(
        "SELECT id, program_id FROM program_activities WHERE id=?", (parent_id,)
    ).fetchone()
    if not parent:
        raise ValueError("Parent activity does not exist")
    if parent["program_id"] != program_id:
        raise ValueError("Parent activity belongs to a different program")


def _is_descendant(db, ancestor_id, candidate_id):
    visited = set()
    queue = [ancestor_id]
    while queue:
        current = queue.pop(0)
        if current in visited:
            continue
        visited.add(current)
        children = db.execute(
            "SELECT id FROM program_activities WHERE parent_id=?", (current,)
        ).fetchall()
        for child in children:
            if child["id"] == candidate_id:
                return True
            queue.append(child["id"])
    return False


def _check_depth_limit(db, parent_id):
    if parent_id is None:
        return
    depth = _get_depth(db, parent_id) + 1
    if depth >= MAX_ACTIVITY_DEPTH:
        raise ValueError(f"Maximum activity nesting depth of {MAX_ACTIVITY_DEPTH} reached")


def _can_assign_to(db, assigner_id, assignee_id):
    if assigner_id == assignee_id:
        return True
    rel = db.execute(
        "SELECT 1 FROM reporting_relationships "
        "WHERE employee_id=? AND supervisor_id=? AND relationship_type='primary' AND is_active=1 "
        "LIMIT 1",
        (assignee_id, assigner_id),
    ).fetchone()
    if rel:
        return True
    emp = db.execute("SELECT manager_id FROM employees WHERE id=?", (assignee_id,)).fetchone()
    if emp and emp["manager_id"] == assigner_id:
        return True
    return False


def _get_assignable_employees(db, assigner_id):
    rows = rows_to_list(
        db.execute(
            "SELECT e.id, e.full_name, d.name as department_name "
            "FROM employees e LEFT JOIN departments d ON d.id = e.department_id "
            "WHERE e.id != ? AND ("
            "  EXISTS (SELECT 1 FROM reporting_relationships "
            "          WHERE employee_id=e.id AND supervisor_id=? "
            "          AND relationship_type='primary' AND is_active=1)"
            "  OR e.manager_id=?"
            ") ORDER BY e.full_name",
            (assigner_id, assigner_id, assigner_id),
        ).fetchall()
    )
    return rows


def _is_assigner_or_supervisor(db, activity_id, user_id):
    activity = db.execute("SELECT assigned_by FROM program_activities WHERE id=?", (activity_id,)).fetchone()
    if not activity:
        return False
    if activity["assigned_by"] == user_id:
        return True
    if activity["assigned_by"] is None:
        # NULL assigned_by: only program owner or admin can reassign
        proj = db.execute(
            "SELECT p.owner_id FROM program_activities t JOIN programs p ON p.id=t.program_id WHERE t.id=?",
            (activity_id,),
        ).fetchone()
        if proj and (proj["owner_id"] == user_id or g.user["role"] == "admin"):
            return True
        return False
    return _can_assign_to(db, user_id, activity["assigned_by"])


def _activity_tree(db, program_id):
    activities = rows_to_list(
        db.execute(
            "SELECT t.*, e.full_name as assignee_name, "
            "a.full_name as assigned_by_name, "
            "d.name as org_unit_name, "
            "sg.title AS strategic_goal_title, sg.scope AS strategic_goal_scope "
            "FROM program_activities t "
            "LEFT JOIN employees e ON e.id = t.assignee_id "
            "LEFT JOIN employees a ON a.id = t.assigned_by "
            "LEFT JOIN departments d ON d.id = t.org_unit_id "
            "LEFT JOIN strategic_goals sg ON sg.id = t.strategic_goal_id "
            "WHERE t.program_id=? ORDER BY t.id",
            (program_id,),
        ).fetchall()
    )
    activity_map = {t["id"]: {**t, "children": [], "kpis": []} for t in activities}
    roots = []
    for t in activities:
        kpis = rows_to_list(
            db.execute("SELECT * FROM activity_kpis WHERE activity_id=?", (t["id"],)).fetchall()
        )
        activity_map[t["id"]]["kpis"] = kpis
        if t["parent_id"] and t["parent_id"] in activity_map:
            activity_map[t["parent_id"]]["children"].append(activity_map[t["id"]])
        else:
            roots.append(activity_map[t["id"]])
    return roots


def _has_children(db, activity_id):
    row = db.execute("SELECT 1 FROM program_activities WHERE parent_id=? LIMIT 1", (activity_id,)).fetchone()
    return row is not None


def _has_kpis(db, activity_id):
    row = db.execute("SELECT 1 FROM activity_kpis WHERE activity_id=? LIMIT 1", (activity_id,)).fetchone()
    return row is not None


def _emp_unit(db, employee_id):
    row = db.execute("SELECT department_id FROM employees WHERE id=?", (employee_id,)).fetchone()
    return row["department_id"] if row else None


def _can_view_program(db, user, program_id):
    """Apply the same scope used by the program list to detail endpoints."""
    role = user.get("role")
    uid = user.get("employee_id")
    if role in ("admin", "executive"):
        return True
    program = db.execute("SELECT owner_id FROM programs WHERE id=?", (program_id,)).fetchone()
    if not program:
        return False
    if program["owner_id"] == uid:
        return True
    # An empty program has no employee or departmental work to expose. Keep
    # score/detail preview usable for newly created sponsor programs while
    # applying strict scope once activities exist.
    if not db.execute(
            "SELECT 1 FROM program_activities WHERE program_id=? LIMIT 1", (program_id,)
    ).fetchone():
        return True
    if role in ("director", "dept_head", "manager"):
        my_unit = _emp_unit(db, uid)
        unit_ids = subtree_unit_ids(db, my_unit) if my_unit else []
        return bool(unit_ids) and db.execute(
            "SELECT 1 FROM program_activities WHERE program_id=? AND org_unit_id IN ({}) LIMIT 1".format(
                ",".join("?" * len(unit_ids))), (program_id, *unit_ids)
        ).fetchone() is not None
    if role == "team_leader":
        my_unit = _emp_unit(db, uid)
        return my_unit is not None and db.execute(
            "SELECT 1 FROM program_activities WHERE program_id=? AND org_unit_id=? LIMIT 1",
            (program_id, my_unit),
        ).fetchone() is not None
    if role == "employee":
        return db.execute(
            "SELECT 1 FROM program_activities WHERE program_id=? AND assignee_id=? LIMIT 1",
            (program_id, uid),
        ).fetchone() is not None
    return False


def _unit_level(db, unit_id):
    if not unit_id:
        return None
    row = db.execute(
        "SELECT out.level_order FROM departments d "
        "LEFT JOIN org_unit_types out ON out.id = d.unit_type_id WHERE d.id=?",
        (unit_id,),
    ).fetchone()
    return row["level_order"] if row else None


def _can_manage_activity(db, activity, role, employee_id):
    """Scope gate for managing an activity (KPI/progress/delete)."""
    if role == "admin":
        return True
    my_unit = _emp_unit(db, employee_id)
    if role == "dept_head":
        if activity["org_unit_id"]:
            return bool(my_unit) and activity["org_unit_id"] in subtree_unit_ids(db, my_unit)
        return activity["assigned_by"] == employee_id
    if role == "team_leader":
        return bool(my_unit) and activity["org_unit_id"] == my_unit
    return False


def _normalize_activity_kpis(kpis):
    """Validate + normalize an optional inline KPI payload for activity create."""
    if kpis is None:
        return [], None
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
        if kpi_type not in ("percentage", "numeric", "milestone"):
            return [], (400, f"kpis[{i}]: kpi_type must be percentage/numeric/milestone")
        direction = k.get("direction") or "higher_is_better"
        if direction not in ("higher_is_better", "lower_is_better", "target_is_best"):
            return [], (400, f"kpis[{i}]: direction must be higher_is_better/lower_is_better/target_is_best")
        try:
            target_value = float(k["target_value"]) if k.get("target_value") is not None else None
        except (TypeError, ValueError):
            return [], (400, f"kpis[{i}]: target_value must be a number")
        try:
            actual_value = float(k["actual_value"]) if k.get("actual_value") is not None else None
        except (TypeError, ValueError):
            return [], (400, f"kpis[{i}]: actual_value must be a number")
        try:
            weight = float(k.get("weight", 1))
        except (TypeError, ValueError):
            return [], (400, f"kpis[{i}]: weight must be a number")
        out.append({
            "name": name, "kpi_type": kpi_type, "target_value": target_value,
            "actual_value": actual_value, "unit": (k.get("unit") or "").strip() or None,
            "weight": weight, "direction": direction,
        })
    return out, None


def _goal_in_scope(db, uid, role, goal):
    """True when the goal is within the caller's operational scope."""
    if role == "admin":
        return True
    if goal["scope"] in ("annual", "quarterly"):
        return True
    my_unit = _emp_unit(db, uid)
    if not my_unit:
        return goal["assigned_to_id"] == uid or goal["owner_id"] == uid
    return (goal["org_unit_id"] in subtree_unit_ids(db, my_unit)
            or goal["assigned_to_id"] == uid or goal["owner_id"] == uid)


def _validate_goal_link(db, uid, role, goal_id, assignee_id, org_unit_id=None):
    """Return (ok, err) for attaching an activity to a strategic goal.

    Assessment semantics: an activity "serves" the plan/goal it links to.
    individual tasks must be served by the very member they are assigned to;
    team/quarterly plans must contain the activity's team (or member)."""
    if goal_id is None:
        return True, None
    goal = db.execute(
        "SELECT id, title, scope, status, org_unit_id, assigned_to_id "
        "FROM strategic_goals WHERE id=?", (goal_id,),
    ).fetchone()
    if not goal:
        return False, (404, "linked strategic goal not found")
    if goal["status"] == "cancelled":
        return False, (400, "cancelled goals cannot be linked to activities")
    if not _goal_in_scope(db, uid, role, goal):
        return False, (403, "the linked goal is outside your scope")
    if goal["scope"] == "individual":
        if not assignee_id or assignee_id != goal["assigned_to_id"]:
            return False, (400, (
                "an individual task can only be served by the activity "
                "assigned to that same member"))
    elif goal["scope"] in ("team", "quarterly"):
        inside = False
        if org_unit_id and goal["org_unit_id"]:
            inside = org_unit_id in subtree_unit_ids(db, goal["org_unit_id"])
        if not inside and assignee_id:
            u = _emp_unit(db, assignee_id)
            inside = bool(u) and (
                not goal["org_unit_id"] or u in subtree_unit_ids(db, goal["org_unit_id"]))
        if not inside:
            return False, (403, "the activity team/member must be inside the linked goal's org unit")
    return True, None


def _propagate_progress(db, activity_id):
    children = rows_to_list(
        db.execute("SELECT id, weight, progress_pct FROM program_activities WHERE parent_id=?", (activity_id,)).fetchall()
    )
    if not children:
        return
    total_w = sum(c["weight"] or 1 for c in children)
    avg = sum((c["progress_pct"] or 0) * (c["weight"] or 1) for c in children) / total_w if total_w else 0
    db.execute("UPDATE program_activities SET progress_pct=? WHERE id=?", (round(avg, 1), activity_id))
    parent = db.execute("SELECT parent_id FROM program_activities WHERE id=?", (activity_id,)).fetchone()
    if parent and parent["parent_id"]:
        _propagate_progress(db, parent["parent_id"])


def _recalc_progress_from_kpis(db, activity_id):
    """Recalculate a activity's progress_pct from its KPI actuals, then propagate up."""
    kpis = rows_to_list(
        db.execute("SELECT * FROM activity_kpis WHERE activity_id=?", (activity_id,)).fetchall()
    )
    if not kpis:
        db.execute("UPDATE program_activities SET progress_pct=0 WHERE id=?", (activity_id,))
        activity = db.execute("SELECT parent_id FROM program_activities WHERE id=?", (activity_id,)).fetchone()
        if activity and activity["parent_id"]:
            _propagate_progress(db, activity["parent_id"])
        return
    for k in kpis:
        k["achievement_pct"] = compute_activity_kpi_score(k)
    total_w = sum(k["weight"] or 1 for k in kpis)
    avg = sum(k["achievement_pct"] * (k["weight"] or 1) for k in kpis) / total_w if total_w else 0
    db.execute("UPDATE program_activities SET progress_pct=? WHERE id=?", (round(avg, 1), activity_id))
    _auto_set_activity_status(db, activity_id, avg)
    activity = db.execute("SELECT parent_id FROM program_activities WHERE id=?", (activity_id,)).fetchone()
    if activity and activity["parent_id"]:
        _propagate_progress(db, activity["parent_id"])


def _auto_set_activity_status(db, activity_id, progress_pct):
    """Derive activity status from progress and due date."""
    activity = db.execute("SELECT status, due_date FROM program_activities WHERE id=?", (activity_id,)).fetchone()
    if not activity or activity["status"] == "cancelled":
        return
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    due_passed = activity["due_date"] and activity["due_date"] < now
    if progress_pct >= 100:
        new_status = "completed"
    elif progress_pct > 0:
        new_status = "on_hold" if due_passed else "in_progress"
    else:
        new_status = "on_hold" if due_passed else "not_started"
    if new_status != activity["status"]:
        db.execute("UPDATE program_activities SET status=? WHERE id=?", (new_status, activity_id))


def _derive_activity_status(db, activity_id):
    """Derive an activity's status from its direct children's statuses."""
    activity = db.execute("SELECT status FROM program_activities WHERE id=?", (activity_id,)).fetchone()
    if not activity or activity["status"] in ("cancelled", "completed"):
        return
    children = rows_to_list(
        db.execute("SELECT status FROM program_activities WHERE parent_id=?", (activity_id,)).fetchall()
    )
    active = [c["status"] for c in children if c["status"] not in ("cancelled",)]
    if not active:
        return
    if all(s == "completed" for s in active):
        new_status = "completed"
    elif any(s == "in_progress" for s in active):
        new_status = "in_progress"
    elif any(s == "on_hold" for s in active):
        new_status = "on_hold"
    elif all(s == "not_started" for s in active):
        new_status = "not_started"
    else:
        return
    if new_status != activity["status"]:
        db.execute("UPDATE program_activities SET status=? WHERE id=?", (new_status, activity_id))
        _log(db, "program_activity", activity_id, "status_update",
             old_value={"status": activity["status"]}, new_value={"status": new_status})


def _derive_program_status(db, program_id):
    """Derive a program's status from its top-level activities' statuses."""
    prog = db.execute("SELECT status FROM programs WHERE id=?", (program_id,)).fetchone()
    if not prog or prog["status"] in ("cancelled", "completed"):
        return
    top = rows_to_list(
        db.execute("SELECT status FROM program_activities WHERE program_id=? AND parent_id IS NULL",
                   (program_id,)).fetchall()
    )
    active = [t["status"] for t in top if t["status"] not in ("cancelled",)]
    if not active:
        return
    if all(s == "completed" for s in active):
        new_status = "completed"
    elif any(s == "in_progress" for s in active):
        new_status = "in_progress"
    elif any(s == "on_hold" for s in active):
        new_status = "on_hold"
    elif all(s == "not_started" for s in active):
        new_status = "planning"
    else:
        return
    if new_status != prog["status"]:
        db.execute("UPDATE programs SET status=? WHERE id=?", (new_status, program_id))
        _log(db, "program", program_id, "status_update",
             old_value={"status": prog["status"]}, new_value={"status": new_status})


def _propagate_status(db, activity_id):
    """Walk up from an activity to derive ancestor statuses, then the program."""
    activity = db.execute(
        "SELECT parent_id, program_id FROM program_activities WHERE id=?", (activity_id,)
    ).fetchone()
    if not activity:
        return
    if activity["parent_id"]:
        _derive_activity_status(db, activity["parent_id"])
        _propagate_status(db, activity["parent_id"])
    else:
        _derive_program_status(db, activity["program_id"])


# ---- Assignable Employees ----

@bp.get("/assignable")
@login_required
def assignable_employees():
    db = get_db()
    try:
        rows = _get_assignable_employees(db, g.user["employee_id"])
        return jsonify(rows)
    finally:
        db.close()


@bp.get("/for-goals")
@login_required
@roles_required("admin", "executive")
def programs_for_goals():
    """Programs an executive may coin a grand goal from, regardless of
    ownership (annual goals are org-wide, so every program is a candidate)."""
    db = get_db()
    try:
        rows = rows_to_list(
            db.execute(
                "SELECT p.id, p.name FROM programs p "
                "WHERE p.status != 'cancelled' "
                "ORDER BY p.created_at DESC, p.id DESC"
            ).fetchall()
        )
        return jsonify(rows)
    finally:
        db.close()


@bp.get("/for-department")
@login_required
@roles_required("admin", "dept_head", "director")
def programs_for_department():
    """Programs a department can set activities inside (planner picker).
    Unscoped by ownership: a program is the org-wide umbrella the department
    executes within."""
    db = get_db()
    try:
        cycle_id = request.args.get("cycle_id", type=int)
        params = []
        where = "WHERE p.status != 'cancelled'"
        if cycle_id:
            where += " AND p.cycle_id=?"
            params.append(cycle_id)
        rows = rows_to_list(
            db.execute(
                f"SELECT p.id, p.name, p.cycle_id FROM programs p {where} "
                "ORDER BY p.created_at DESC, p.id DESC",
                params,
            ).fetchall()
        )
        return jsonify(rows)
    finally:
        db.close()


@bp.get("/assignable-teams")
@login_required
@roles_required("admin", "dept_head")
def assignable_teams():
    """Teams (level-3 org units) the caller may assign activities to."""
    db = get_db()
    try:
        role = g.user.get("role")
        if role == "admin":
            rows = rows_to_list(db.execute(
                "SELECT d.id, d.name FROM departments d "
                "JOIN org_unit_types out ON out.id = d.unit_type_id "
                "WHERE out.level_order = 3 ORDER BY d.name"
            ).fetchall())
        else:
            my_unit = _emp_unit(db, g.user["employee_id"])
            unit_ids = subtree_unit_ids(db, my_unit) if my_unit else []
            if not unit_ids:
                rows = []
            else:
                marks = ",".join("?" * len(unit_ids))
                rows = rows_to_list(db.execute(
                    f"SELECT d.id, d.name FROM departments d "
                    f"JOIN org_unit_types out ON out.id = d.unit_type_id "
                    f"WHERE d.id IN ({marks}) AND out.level_order = 3 ORDER BY d.name",
                    (*unit_ids,),
                ).fetchall())
        return jsonify(rows)
    finally:
        db.close()


@bp.get("/<int:program_id>/assignable-goals")
@login_required
@roles_required("admin", "executive", *SUPERVISOR_ROLES)
def assignable_goals(program_id):
    """Strategic goals the current user may attach this program's activities
    to, for an optional assignee / team. Respects goal compartmentation so no
    goal outside the caller's scope is ever surfaced."""
    db = get_db()
    try:
        proj = db.execute("SELECT id FROM programs WHERE id=?", (program_id,)).fetchone()
        if not proj:
            return jsonify({"error": "Program not found"}), 404

        assignee_id = request.args.get("assignee_id", type=int)
        org_unit_id = request.args.get("org_unit_id", type=int)
        uid = g.user.get("employee_id")
        role = g.user.get("role")

        rows = rows_to_list(db.execute(
            "SELECT id, title, scope, status, assigned_to_id, org_unit_id "
            "FROM strategic_goals WHERE status != 'cancelled' "
            "ORDER BY scope, year DESC, quarter DESC, id"
        ).fetchall())

        out = []
        for goal in rows:
            ok, err = _validate_goal_link(db, uid, role, goal["id"], assignee_id, org_unit_id)
            if ok:
                out.append({
                    "id": goal["id"],
                    "title": goal["title"],
                    "scope": goal["scope"],
                })
        return jsonify(out)
    finally:
        db.close()


# ---- Programs ----

@bp.get("")
@login_required
def list_programs():
    cycle_id = request.args.get("cycle_id", type=int)
    db = get_db()
    try:
        where = "WHERE p.status != 'cancelled'"
        params = []
        if cycle_id:
            where += " AND p.cycle_id=?"
            params.append(cycle_id)

        role = g.user["role"]
        if role in ("admin", "executive"):
            # Program sponsors see all non-cancelled programs.
            pass
        elif role in ("director", "dept_head", "manager"):
            my_unit = _emp_unit(db, g.user["employee_id"])
            unit_ids = subtree_unit_ids(db, my_unit) if my_unit else []
            if unit_ids:
                marks = ",".join("?" * len(unit_ids))
                where += (" AND (p.owner_id=? OR EXISTS (SELECT 1 FROM program_activities pt "
                          f"WHERE pt.program_id=p.id AND pt.org_unit_id IN ({marks})))")
                params.extend([g.user["employee_id"], *unit_ids])
            else:
                where += " AND p.owner_id=?"
                params.append(g.user["employee_id"])
        elif role == "team_leader":
            my_unit = _emp_unit(db, g.user["employee_id"])
            where += (" AND (p.owner_id=? OR EXISTS (SELECT 1 FROM program_activities pt "
                      "WHERE pt.program_id=p.id AND pt.org_unit_id=?))")
            params.extend([g.user["employee_id"], my_unit])
        elif role == "employee":
            where += " AND EXISTS (SELECT 1 FROM program_activities pt WHERE pt.program_id=p.id AND pt.assignee_id=?)"
            params.append(g.user["employee_id"])
        else:
            # Unknown role: nothing.
            where += " AND 0=1"

        rows = rows_to_list(
            db.execute(
                f"SELECT p.*, e.full_name as owner_name, "
                f"(SELECT COUNT(*) FROM program_activities WHERE program_id=p.id) as activity_count, "
                f"(SELECT COUNT(*) FROM program_activities WHERE program_id=p.id AND status='completed') as completed_activities "
                f"FROM programs p LEFT JOIN employees e ON e.id=p.owner_id {where} ORDER BY p.created_at DESC",
                params,
            ).fetchall()
        )
        return jsonify(rows)
    finally:
        db.close()


@bp.post("")
@roles_required("admin", "executive", "director")
def create_program():
    data = request.get_json(force=True) or {}
    if not data.get("name"):
        return jsonify({"error": "name required"}), 400
    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO programs (name, description, owner_id, created_by, cycle_id, start_date, due_date, status, weight) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (
                data["name"], data.get("description"), data.get("owner_id", g.user["employee_id"]),
                g.user["employee_id"],
                data.get("cycle_id"), data.get("start_date"), data.get("due_date"),
                data.get("status", "planning"), data.get("weight", 1),
            ),
        )
        _log(db, "program", cur.lastrowid, "create", new_value=data)
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201
    finally:
        db.close()


@bp.get("/<int:program_id>")
@login_required
def get_program(program_id):
    db = get_db()
    try:
        proj = row_to_dict(
            db.execute(
                "SELECT p.*, e.full_name as owner_name FROM programs p "
                "LEFT JOIN employees e ON e.id=p.owner_id WHERE p.id=?",
                (program_id,),
            ).fetchone()
        )
        if not proj:
            return jsonify({"error": "Not found"}), 404
        if not _can_view_program(db, g.user, program_id):
            return jsonify({"error": "Forbidden"}), 403
        proj["activities"] = _activity_tree(db, program_id)
        return jsonify(proj)
    finally:
        db.close()


@bp.put("/<int:program_id>")
@roles_required("admin", "executive", *SUPERVISOR_ROLES)
def update_program(program_id):
    data = request.get_json(force=True) or {}
    db = get_db()
    try:
        proj = db.execute("SELECT * FROM programs WHERE id=?", (program_id,)).fetchone()
        if not proj:
            return jsonify({"error": "Not found"}), 404
        if proj["owner_id"] != g.user["employee_id"] and g.user["role"] != "admin":
            return jsonify({"error": "Only the program owner or an admin can update this program"}), 403
        fields = ["name", "description", "owner_id", "cycle_id", "start_date", "due_date", "status", "weight"]
        updates = {f: data[f] for f in fields if f in data}
        if updates:
            set_clause = ", ".join(f"{k}=?" for k in updates)
            db.execute(f"UPDATE programs SET {set_clause} WHERE id=?", (*updates.values(), program_id))
            _log(db, "program", program_id, "update", old_value=row_to_dict(proj), new_value=updates)
            db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


@bp.delete("/<int:program_id>")
@roles_required("admin", "executive", *SUPERVISOR_ROLES)
def delete_program(program_id):
    db = get_db()
    try:
        proj = db.execute("SELECT * FROM programs WHERE id=?", (program_id,)).fetchone()
        if not proj:
            return jsonify({"error": "Not found"}), 404
        if proj["owner_id"] != g.user["employee_id"] and g.user["role"] != "admin":
            return jsonify({"error": "Only the program owner or an admin can delete this program"}), 403
        # Strategic goals may outlive their source program. Detach those links
        # explicitly because the goal foreign key intentionally preserves goals
        # when a program is removed.
        db.execute("UPDATE strategic_goals SET program_id=NULL WHERE program_id=?", (program_id,))
        db.execute("UPDATE program_activities SET strategic_goal_id=NULL WHERE program_id=?", (program_id,))
        db.execute("DELETE FROM programs WHERE id=?", (program_id,))
        _log(db, "program", program_id, "delete", old_value=row_to_dict(proj))
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


# ---- Activities ----

@bp.post("/<int:program_id>/activities")
@login_required
@roles_required(*ACTIVITY_AUTHOR_ROLES)
def create_activity(program_id):
    data = request.get_json(force=True) or {}
    if not data.get("title"):
        return jsonify({"error": "title required"}), 400
    db = get_db()
    try:
        proj = db.execute("SELECT id, status FROM programs WHERE id=?", (program_id,)).fetchone()
        if not proj:
            return jsonify({"error": "Program not found"}), 404
        if proj["status"] in ("completed", "cancelled"):
            return jsonify({"error": f"Cannot add activities to a {proj['status']} program"}), 400

        role = g.user.get("role")
        me = g.user["employee_id"]
        my_unit = _emp_unit(db, me)

        parent_id = data.get("parent_id")
        try:
            _validate_parent(db, program_id, parent_id)
            _check_depth_limit(db, parent_id)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

        assignee_id = data.get("assignee_id")
        org_unit_id = data.get("org_unit_id")

        if role == "team_leader":
            # Drill-down: team leaders break a team activity into member tasks.
            if not parent_id:
                return jsonify({
                    "error": "team leaders can only break a team activity into member tasks"}), 403
            parent = db.execute(
                "SELECT id, org_unit_id FROM program_activities WHERE id=?", (parent_id,)
            ).fetchone()
            if not parent or not parent["org_unit_id"] \
                    or parent["org_unit_id"] != my_unit or _unit_level(db, my_unit) != 3:
                return jsonify({"error": "you can only break down your own team's activities"}), 403
            if not assignee_id:
                return jsonify({"error": "assign a member of the team"}), 400
            if _emp_unit(db, assignee_id) != my_unit:
                return jsonify({"error": "the assignee must be a member of your team"}), 403
            org_unit_id = parent["org_unit_id"]
        else:
            # Dept head / admin: set an activity for a team in scope.
            if parent_id:
                parent = db.execute(
                    "SELECT id, org_unit_id FROM program_activities WHERE id=?", (parent_id,)
                ).fetchone()
                if parent:
                    if parent["org_unit_id"] and org_unit_id is not None \
                            and org_unit_id != parent["org_unit_id"]:
                        return jsonify({"error": "a sub-activity must stay in its parent's team"}), 400
                    org_unit_id = org_unit_id or parent["org_unit_id"]
            if not org_unit_id:
                return jsonify({
                    "error": "org_unit_id (team) is required for department-set activities"}), 400
            if _unit_level(db, org_unit_id) != 3:
                return jsonify({"error": "activities can only be assigned to team-level units"}), 400
            if role == "dept_head" and (not my_unit
                                        or org_unit_id not in subtree_unit_ids(db, my_unit)):
                return jsonify({"error": "you can only assign activities to teams in your department"}), 403
            if assignee_id and _emp_unit(db, assignee_id) != org_unit_id:
                return jsonify({"error": "the assignee must be a member of the assigned team"}), 403

        strategic_goal_id = data.get("strategic_goal_id")
        if strategic_goal_id is not None:
            ok, err = _validate_goal_link(
                db, me, role, strategic_goal_id, assignee_id, org_unit_id)
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
                program_id, parent_id, data["title"], data.get("description"),
                assignee_id, org_unit_id, data.get("start_date"), data.get("due_date"),
                data.get("status", "not_started"), data.get("progress_pct", 0),
                data.get("weight", 1), me, strategic_goal_id,
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
        _log(db, "program_activity", activity_id, "create", new_value=data)
        if kpis and any(k["actual_value"] is not None for k in kpis):
            _recalc_progress_from_kpis(db, activity_id)
            _propagate_status(db, activity_id)
        elif parent_id:
            _propagate_progress(db, parent_id)
        db.commit()
        return jsonify({"id": activity_id}), 201
    finally:
        db.close()


@bp.put("/activities/<int:activity_id>")
@login_required
@roles_required(*ACTIVITY_AUTHOR_ROLES)
def update_activity(activity_id):
    data = request.get_json(force=True) or {}
    db = get_db()
    try:
        activity = db.execute("SELECT * FROM program_activities WHERE id=?", (activity_id,)).fetchone()
        if not activity:
            return jsonify({"error": "Not found"}), 404
        role = g.user.get("role")
        me = g.user["employee_id"]
        if not _can_manage_activity(db, activity, role, me):
            return jsonify({"error": "You may only manage activities inside your scope"}), 403

        if "progress_pct" in data:
            if _has_children(db, activity_id) or _has_kpis(db, activity_id):
                return jsonify({
                    "error": "progress_pct is read-only for activities with children or KPIs. "
                             "Use POST /activities/<id>/progress to log progress, or update KPI actual values."
                }), 400
            data["progress_pct"] = max(0.0, min(100.0, float(data["progress_pct"])))

        my_unit = _emp_unit(db, me)
        if "org_unit_id" in data and data["org_unit_id"] != activity["org_unit_id"]:
            if role == "team_leader":
                return jsonify({"error": "team leaders cannot move activities between teams"}), 403
            new_unit = data["org_unit_id"]
            if new_unit is not None:
                if _unit_level(db, new_unit) != 3:
                    return jsonify({"error": "activities can only be assigned to team-level units"}), 400
                if role == "dept_head" and (not my_unit
                                            or new_unit not in subtree_unit_ids(db, my_unit)):
                    return jsonify({"error": "you can only assign activities to teams in your department"}), 403

        if "assignee_id" in data and data["assignee_id"] != activity["assignee_id"]:
            target_unit = data.get("org_unit_id", activity["org_unit_id"])
            if role == "team_leader":
                if not target_unit or target_unit != my_unit:
                    return jsonify({"error": "you can only drill down inside your own team"}), 403
                if data["assignee_id"] and _emp_unit(db, data["assignee_id"]) != my_unit:
                    return jsonify({"error": "the assignee must be a member of your team"}), 403
            else:
                if not target_unit:
                    return jsonify({"error": "org_unit_id (team) is required"}), 400
                if data["assignee_id"] and _emp_unit(db, data["assignee_id"]) != target_unit:
                    return jsonify({"error": "the assignee must be a member of the assigned team"}), 403

        if "parent_id" in data and data["parent_id"] != activity["parent_id"]:
            try:
                _validate_parent(db, activity["program_id"], data["parent_id"], exclude_activity_id=activity_id)
                if data["parent_id"] and _is_descendant(db, activity_id, data["parent_id"]):
                    return jsonify({"error": "Cannot reassign to a descendant activity (creates cycle)"}), 400
                _check_depth_limit(db, data["parent_id"])
            except ValueError as e:
                return jsonify({"error": str(e)}), 400

        if "strategic_goal_id" in data and data["strategic_goal_id"] != activity["strategic_goal_id"]:
            if activity["strategic_goal_id"] is not None and not data.get("strategic_goal_id"):
                ok = True
            else:
                new_assignee = data.get("assignee_id", activity["assignee_id"])
                new_unit = data.get("org_unit_id", activity["org_unit_id"])
                ok, err = _validate_goal_link(
                    db, me, role, data["strategic_goal_id"], new_assignee, new_unit)
            if not ok:
                return jsonify({"error": err[1]}), err[0]

        fields = ["title", "description", "assignee_id", "org_unit_id", "start_date", "due_date",
                  "status", "progress_pct", "weight", "parent_id", "strategic_goal_id"]
        updates = {f: data[f] for f in fields if f in data}
        if updates:
            set_clause = ", ".join(f"{k}=?" for k in updates)
            db.execute(f"UPDATE program_activities SET {set_clause} WHERE id=?", (*updates.values(), activity_id))
            _log(db, "program_activity", activity_id, "update", old_value=row_to_dict(activity), new_value=updates)
            # Recalculate old parent progress
            if activity["parent_id"]:
                _propagate_progress(db, activity["parent_id"])
            # Recalculate new parent progress if reparented
            new_parent = data.get("parent_id")
            if new_parent and new_parent != activity["parent_id"]:
                _propagate_progress(db, new_parent)
            # Propagate status changes up the tree and to the program
            if "status" in updates or "progress_pct" in updates:
                _propagate_status(db, activity_id)
            db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


@bp.delete("/activities/<int:activity_id>")
@login_required
@roles_required(*ACTIVITY_AUTHOR_ROLES)
def delete_activity(activity_id):
    db = get_db()
    try:
        activity = db.execute("SELECT * FROM program_activities WHERE id=?", (activity_id,)).fetchone()
        if not activity:
            return jsonify({"error": "Not found"}), 404
        if not _can_manage_activity(db, activity, g.user["role"], g.user["employee_id"]):
            return jsonify({"error": "You may only manage activities inside your scope"}), 403
        parent_id = activity["parent_id"]
        db.execute("DELETE FROM program_activities WHERE id=?", (activity_id,))
        _log(db, "program_activity", activity_id, "delete", old_value=row_to_dict(activity))
        if parent_id:
            _propagate_progress(db, parent_id)
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


# ---- Activity KPIs ----

@bp.get("/activities/<int:activity_id>/kpis")
@login_required
def list_activity_kpis(activity_id):
    db = get_db()
    try:
        activity = db.execute(
            "SELECT program_id FROM program_activities WHERE id=?", (activity_id,)
        ).fetchone()
        if not activity:
            return jsonify({"error": "Not found"}), 404
        if not _can_view_program(db, g.user, activity["program_id"]):
            return jsonify({"error": "Forbidden"}), 403
        rows = rows_to_list(
            db.execute("SELECT * FROM activity_kpis WHERE activity_id=? ORDER BY id", (activity_id,)).fetchall()
        )
        return jsonify(rows)
    finally:
        db.close()


@bp.post("/activities/<int:activity_id>/kpis")
@login_required
@roles_required(*ACTIVITY_AUTHOR_ROLES)
def create_activity_kpi(activity_id):
    data = request.get_json(force=True) or {}
    if not data.get("name") or not data.get("kpi_type"):
        return jsonify({"error": "name and kpi_type required"}), 400
    db = get_db()
    try:
        activity = db.execute("SELECT * FROM program_activities WHERE id=?", (activity_id,)).fetchone()
        if not activity:
            return jsonify({"error": "Activity not found"}), 404
        if not _can_manage_activity(db, activity, g.user["role"], g.user["employee_id"]):
            return jsonify({"error": "You may only manage KPIs inside your scope"}), 403
        cur = db.execute(
            "INSERT INTO activity_kpis (activity_id, name, kpi_type, target_value, actual_value, unit, weight, direction) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (
                activity_id, data["name"], data["kpi_type"], data.get("target_value"),
                data.get("actual_value"), data.get("unit"), data.get("weight", 1),
                data.get("direction", "higher_is_better"),
            ),
        )
        _log(db, "activity_kpi", cur.lastrowid, "create", new_value=data)
        if data.get("actual_value") is not None:
            _recalc_progress_from_kpis(db, activity_id)
            _propagate_status(db, activity_id)
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201
    finally:
        db.close()


@bp.put("/kpis/<int:kpi_id>")
@login_required
def update_activity_kpi(kpi_id):
    data = request.get_json(force=True) or {}
    db = get_db()
    try:
        kpi = db.execute("SELECT * FROM activity_kpis WHERE id=?", (kpi_id,)).fetchone()
        if not kpi:
            return jsonify({"error": "Not found"}), 404
        is_manager_like = g.user["role"] in ACTIVITY_AUTHOR_ROLES
        if is_manager_like:
            activity = db.execute(
                "SELECT * FROM program_activities WHERE id=?", (kpi["activity_id"],)
            ).fetchone()
            if not activity or not _can_manage_activity(
                    db, activity, g.user["role"], g.user["employee_id"]):
                return jsonify({"error": "You may only manage KPIs inside your scope"}), 403
            fields = ["name", "kpi_type", "target_value", "actual_value", "unit", "weight", "direction"]
            updates = {f: data[f] for f in fields if f in data}
        else:
            activity = db.execute(
                "SELECT assignee_id FROM program_activities WHERE id=?", (kpi["activity_id"],)
            ).fetchone()
            if not activity or activity["assignee_id"] != g.user["employee_id"]:
                return jsonify({"error": "You can only update KPIs on activities assigned to you"}), 403
            if any(f in data for f in ("name", "kpi_type", "target_value", "unit", "weight", "direction")):
                return jsonify({"error": "Employees can only update actual_value"}), 403
            if "actual_value" not in data:
                return jsonify({"error": "Nothing to update"}), 400
            updates = {"actual_value": data["actual_value"]}
        if updates:
            set_clause = ", ".join(f"{k}=?" for k in updates)
            db.execute(f"UPDATE activity_kpis SET {set_clause} WHERE id=?", (*updates.values(), kpi_id))
            _log(db, "activity_kpi", kpi_id, "update", old_value=row_to_dict(kpi), new_value=updates)
            if "actual_value" in updates or "target_value" in updates or "weight" in updates:
                _recalc_progress_from_kpis(db, kpi["activity_id"])
                _propagate_status(db, kpi["activity_id"])
            db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


@bp.delete("/kpis/<int:kpi_id>")
@login_required
@roles_required(*ACTIVITY_AUTHOR_ROLES)
def delete_activity_kpi(kpi_id):
    db = get_db()
    try:
        kpi = db.execute("SELECT * FROM activity_kpis WHERE id=?", (kpi_id,)).fetchone()
        if not kpi:
            return jsonify({"error": "Not found"}), 404
        activity = db.execute(
            "SELECT * FROM program_activities WHERE id=?", (kpi["activity_id"],)
        ).fetchone()
        if not activity or not _can_manage_activity(
                db, activity, g.user["role"], g.user["employee_id"]):
            return jsonify({"error": "You may only manage KPIs inside your scope"}), 403
        activity_id = kpi["activity_id"]
        db.execute("DELETE FROM activity_kpis WHERE id=?", (kpi_id,))
        _log(db, "activity_kpi", kpi_id, "delete", old_value=row_to_dict(kpi))
        _recalc_progress_from_kpis(db, activity_id)
        _propagate_status(db, activity_id)
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


# ---- Progress Logs ----

@bp.post("/activities/<int:activity_id>/progress")
@login_required
@roles_required(*ACTIVITY_AUTHOR_ROLES)
def log_progress(activity_id):
    data = request.get_json(force=True) or {}
    if "progress_pct" not in data:
        return jsonify({"error": "progress_pct required"}), 400
    progress = max(0.0, min(100.0, float(data["progress_pct"])))
    db = get_db()
    try:
        activity = db.execute("SELECT * FROM program_activities WHERE id=?", (activity_id,)).fetchone()
        if not activity:
            return jsonify({"error": "Not found"}), 404
        if not _can_manage_activity(db, activity, g.user["role"], g.user["employee_id"]):
            return jsonify({"error": "You may only log progress inside your scope"}), 403
        cur = db.execute(
            "INSERT INTO activity_progress_logs (activity_id, recorded_by, progress_pct, notes) VALUES (?,?,?,?)",
            (activity_id, g.user["employee_id"], progress, data.get("notes")),
        )
        db.execute("UPDATE program_activities SET progress_pct=? WHERE id=?", (progress, activity_id))
        _log(db, "program_activity", activity_id, "progress", new_value={"progress_pct": progress, "notes": data.get("notes")})
        _auto_set_activity_status(db, activity_id, progress)
        _propagate_status(db, activity_id)
        if activity["parent_id"]:
            _propagate_progress(db, activity["parent_id"])
        db.commit()
        return jsonify({"id": cur.lastrowid, "progress_pct": progress}), 201
    finally:
        db.close()


@bp.get("/activities/<int:activity_id>/progress")
@login_required
def list_progress(activity_id):
    db = get_db()
    try:
        activity = db.execute(
            "SELECT program_id FROM program_activities WHERE id=?", (activity_id,)
        ).fetchone()
        if not activity:
            return jsonify({"error": "Not found"}), 404
        if not _can_view_program(db, g.user, activity["program_id"]):
            return jsonify({"error": "Forbidden"}), 403
        rows = rows_to_list(
            db.execute(
                "SELECT pl.*, e.full_name as recorded_by_name FROM activity_progress_logs pl "
                "LEFT JOIN employees e ON e.id=pl.recorded_by WHERE pl.activity_id=? ORDER BY pl.created_at DESC",
                (activity_id,),
            ).fetchall()
        )
        return jsonify(rows)
    finally:
        db.close()


# ---- Score Preview ----

@bp.get("/<int:program_id>/score")
@login_required
def program_score(program_id):
    db = get_db()
    try:
        proj = db.execute("SELECT id, name FROM programs WHERE id=?", (program_id,)).fetchone()
        if not proj:
            return jsonify({"error": "Not found"}), 404
        if not _can_view_program(db, g.user, program_id):
            return jsonify({"error": "Forbidden"}), 403
        roots = rows_to_list(
            db.execute(
                "SELECT id, title, weight, assignee_id FROM program_activities "
                "WHERE program_id=? AND parent_id IS NULL",
                (program_id,),
            ).fetchall()
        )
        activity_scores = []
        for t in roots:
            ts = _activity_score(db, t["id"])
            activity_scores.append({
                "activity": t["title"],
                "activity_id": t["id"],
                "assignee_id": t["assignee_id"],
                "score": round(ts, 2) if ts is not None else None,
                "weight": t["weight"] or 1,
            })
        valid = [t for t in activity_scores if t["score"] is not None]
        if valid:
            total_w = sum(t["weight"] for t in valid)
            overall = sum(t["score"] * t["weight"] for t in valid) / total_w
        else:
            overall = None
        return jsonify({
            "program_id": program_id,
            "program": proj["name"],
            "score": round(overall, 2) if overall is not None else None,
            "activities": activity_scores,
        })
    finally:
        db.close()

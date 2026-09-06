"""Org-unit roll-up overviews.

Each tier leader sees a roll-up of task completion and performance score for
the units in their own org subtree:

  director   -> directorate overview  (directorates -> departments -> teams)
  dept_head  -> department overview   (department -> teams -> members)
  team_leader-> team overview         (team members + task tracking)
  executive  -> grand plan            (strategic goals + completion per directorate/dept)

Scope is enforced by walking the departments.parent_id tree (org_tiers.py), so a
leader can never see data from outside their own org subtree.
"""

from flask import Blueprint, jsonify, g
from database import get_db, rows_to_list
from auth import login_required, roles_required, SUPERVISOR_ROLES
from routes.org_tiers import subtree_unit_ids, employees_in_units
from routes.weekly_plan_routes import _get_week_bounds, _tier_of
from routes.strategic_goal_routes import _rollup_progress
from scoring import calculate_employee_score

bp = Blueprint("tier_overview_routes", __name__, url_prefix="/api/tiers")


def _current_cycle_id(db):
    row = db.execute(
        "SELECT id FROM performance_cycles WHERE status='active' ORDER BY id DESC LIMIT 1"
    ).fetchone()
    return row["id"] if row else None


def _unit_nodes(db, unit_ids):
    """departments rows for the given unit ids, as plain dicts."""
    if not unit_ids:
        return []
    marks = ",".join("?" * len(unit_ids))
    return [dict(r) for r in db.execute(
        f"SELECT id, name, unit_type_id, parent_id FROM departments WHERE id IN ({marks})",
        (*unit_ids,),
    ).fetchall()]


def _task_stats(db, employee_id, week_start):
    """(total, done, in_progress, tasks) for an employee's plan in a week."""
    plan = db.execute(
        "SELECT id FROM weekly_plans WHERE employee_id=? AND week_start=?", (employee_id, week_start)
    ).fetchone()
    if not plan:
        return 0, 0, 0, []
    pid = plan["id"]
    total = db.execute("SELECT COUNT(*) c FROM weekly_tasks WHERE plan_id=?", (pid,)).fetchone()["c"]
    done = db.execute(
        "SELECT COUNT(*) c FROM weekly_tasks WHERE plan_id=? AND status='done'", (pid,)
    ).fetchone()["c"]
    in_progress = db.execute(
        "SELECT COUNT(*) c FROM weekly_tasks WHERE plan_id=? AND status='in_progress'", (pid,)
    ).fetchone()["c"]
    tasks = rows_to_list(db.execute(
        "SELECT wt.*, sg.title AS strategic_goal_title "
        "FROM weekly_tasks wt LEFT JOIN strategic_goals sg ON sg.id = wt.strategic_goal_id "
        "WHERE wt.plan_id=? ORDER BY wt.sort_order", (pid,)
    ).fetchall())
    return total, done, in_progress, tasks


def _performance_score(db, employee_id, cycle_id):
    if not cycle_id:
        return None
    try:
        result = calculate_employee_score(employee_id, cycle_id, persist=False, db=db)
        return result.get("overall_score") if result else None
    except Exception:
        return None


def _eval_score(db, employee_id, cycle_id):
    """The subject's evaluation-derived score for the cycle: their latest
    finalized 360 overall (or auto dept-head score), from evaluation
    assignments. Distinct from task completion on the same unit roll-up."""
    if not cycle_id:
        return None
    row = db.execute(
        "SELECT MAX(overall_score) score FROM evaluation_assignments "
        "WHERE employee_id=? AND cycle_id=? AND status='scored' "
        "AND overall_score IS NOT NULL",
        (employee_id, cycle_id)).fetchone()
    return row["score"] if row else None


def _employee_summary(db, emp, week_start, cycle_id, with_tasks=False):
    total, done, in_progress, tasks = _task_stats(db, emp["id"], week_start)
    return {
        "employee_id": emp["id"],
        "full_name": emp["full_name"],
        "position": emp.get("position"),
        "department_id": emp["department_id"],
        "total_tasks": total,
        "done_tasks": done,
        "in_progress_tasks": in_progress,
        "completion_pct": round(done / total * 100) if total > 0 else 0,
        "performance_score": _performance_score(db, emp["id"], cycle_id),
        "eval_score": _eval_score(db, emp["id"], cycle_id),
        **({"tasks": tasks} if with_tasks else {}),
    }


def _build_tree(db, root_unit_id, week_start, cycle_id, with_tasks=False, depth=None):
    """Recursively build a nested unit summary tree rooted at `root_unit_id`."""
    unit_ids = subtree_unit_ids(db, root_unit_id)
    nodes = {n["id"]: n for n in _unit_nodes(db, unit_ids)}
    units_by_parent = {}
    for n in nodes.values():
        units_by_parent.setdefault(n["parent_id"], []).append(n)

    # employees by department id (only direct members of each unit, not descendants)
    emps = employees_in_units(db, unit_ids)
    emps_by_unit = {}
    for e in emps:
        emps_by_unit.setdefault(e["department_id"], []).append(e)

    def build(uid):
        node = nodes.get(uid, {"id": uid, "name": str(uid)})
        children = []
        agg_total = agg_done = agg_in_progress = 0
        score_sum = 0.0
        score_n = 0
        eval_sum = 0.0
        eval_n = 0

        for cu in sorted(units_by_parent.get(uid, []), key=lambda x: x["name"]):
            child = build(cu["id"])
            children.append(child)
            agg_total += child["total_tasks"]
            agg_done += child["done_tasks"]
            agg_in_progress += child["in_progress_tasks"]
            if child["average_score"] is not None:
                score_sum += child["average_score"] * child["scored_count"]
                score_n += child["scored_count"]
            if child["avg_eval_score"] is not None:
                eval_sum += child["avg_eval_score"] * child["eval_count"]
                eval_n += child["eval_count"]

        members = []
        for e in emps_by_unit.get(uid, []):
            m = _employee_summary(db, e, week_start, cycle_id, with_tasks)
            members.append(m)
            agg_total += m["total_tasks"]
            agg_done += m["done_tasks"]
            agg_in_progress += m["in_progress_tasks"]
            if m["performance_score"] is not None:
                score_sum += m["performance_score"]
                score_n += 1
            if m["eval_score"] is not None:
                eval_sum += m["eval_score"]
                eval_n += 1

        unit_member_count = len(members)
        total_member_count = unit_member_count + sum(c["member_count"] for c in children)

        return {
            "unit_id": node["id"],
            "name": node["name"],
            "unit_type_id": node.get("unit_type_id"),
            "total_tasks": agg_total,
            "done_tasks": agg_done,
            "in_progress_tasks": agg_in_progress,
            "completion_pct": round(agg_done / agg_total * 100) if agg_total > 0 else 0,
            "member_count": total_member_count,
            "direct_member_count": unit_member_count,
            "average_score": round(score_sum / score_n, 2) if score_n > 0 else None,
            "scored_count": score_n,
            "avg_eval_score": round(eval_sum / eval_n, 2) if eval_n > 0 else None,
            "eval_count": eval_n,
            "members": members,
            "children": children,
        }

    return build(root_unit_id)


def _scope_root(db, role, uid):
    """The root unit to roll up from for the current viewer."""
    if role in ("admin", "executive"):
        row = db.execute(
            "SELECT id FROM departments WHERE parent_id IS NULL ORDER BY id LIMIT 1"
        ).fetchone()
        return row["id"] if row else None
    me = db.execute("SELECT department_id FROM employees WHERE id=?", (uid,)).fetchone()
    return me["department_id"] if me else None


@bp.get("/overview")
@login_required
@roles_required(*SUPERVISOR_ROLES)
def tier_overview():
    """Return the nested roll-up tree for the caller's tier scope."""
    db = get_db()
    try:
        uid = g.user.get("employee_id")
        role = g.user.get("role")
        week_start, _ = _get_week_bounds()
        cycle_id = _current_cycle_id(db)
        tier = "executive" if role == "admin" else _tier_of(db, uid)

        root = _scope_root(db, role, uid)
        if root is None:
            return jsonify({"error": "no org unit scope"}), 400

        tree = _build_tree(db, root, week_start, cycle_id, with_tasks=(tier == "team_leader"))
        return jsonify({"tier": tier, "week_start": week_start, "tree": tree})
    finally:
        db.close()


@bp.get("/grand-plan")
@login_required
@roles_required("admin", "executive")
def grand_plan():
    """Executive roll-up: strategic goals + task completion per directorate/dept."""
    db = get_db()
    try:
        uid = g.user.get("employee_id")
        week_start, _ = _get_week_bounds()
        cycle_id = _current_cycle_id(db)

        root = db.execute(
            "SELECT id FROM departments WHERE parent_id IS NULL ORDER BY id LIMIT 1"
        ).fetchone()
        if root is None:
            return jsonify({"error": "no org repo"}), 400

        tree = _build_tree(db, root["id"], week_start, cycle_id, with_tasks=False)

        # Strategic goals (annual + quarterly) with completion progress.
        # Progress is COMPUTED (rolled up: weekly execution blended with linked
        # program activity KPIs down to the leaves), never the stale stored %
        # that vanishes as the week moves on.
        goals = rows_to_list(db.execute(
            "SELECT sg.id, sg.title, sg.scope, sg.status, sg.progress_pct, sg.quarter, sg.year, "
            "sg.program_id, pr.name AS program_name, d.name AS org_unit_name "
            "FROM strategic_goals sg "
            "LEFT JOIN programs pr ON pr.id = sg.program_id "
            "LEFT JOIN departments d ON d.id = sg.org_unit_id "
            "WHERE sg.scope IN ('annual','quarterly') AND sg.status != 'cancelled' "
            "ORDER BY sg.year DESC, sg.quarter DESC"
        ).fetchall())

        for goal in goals:
            goal["progress_pct"] = _rollup_progress(db, goal["id"])

        return jsonify({
            "week_start": week_start,
            "tree": tree,
            "goals": goals,
        })
    finally:
        db.close()

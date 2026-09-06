from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, g
from database import get_db, rows_to_list, row_to_dict
from auth import login_required, roles_required, READ_ROLES
from routes.utils import log_audit
from routes.org_tiers import subtree_unit_ids, employees_in_units

bp = Blueprint("weekly_plan_routes", __name__, url_prefix="/api/weekly-plans")

# Roles that can view plans at a supervisory scope.
SUPERVISOR_ROLES = ("director", "dept_head", "team_leader", "executive", "admin", "manager")
TASK_STATUSES = ("todo", "in_progress", "done")

_WEEKDAY_NAMES = {
    1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday",
}


def _get_week_bounds(date=None):
    """Get Monday-Friday bounds for the given date (default: today)."""
    if date is None:
        date = datetime.now().date()
    elif isinstance(date, str):
        date = datetime.strptime(date, "%Y-%m-%d").date()

    # Find Monday
    monday = date - timedelta(days=date.weekday())
    friday = monday + timedelta(days=4)
    return monday.strftime("%Y-%m-%d"), friday.strftime("%Y-%m-%d")


def _employee_full_name(db, employee_id):
    if not employee_id:
        return None
    row = db.execute(
        "SELECT full_name, department_id FROM employees WHERE id=?", (employee_id,)
    ).fetchone()
    return dict(row) if row else None


# ---------------------------------------------------------------------------
# Employee: own plan + daily follow-up
# ---------------------------------------------------------------------------
@bp.get("/current")
@login_required
def get_current_plan():
    db = get_db()
    try:
        uid = g.user.get("employee_id")
        week_start, week_end = _get_week_bounds()

        plan = row_to_dict(db.execute(
            "SELECT * FROM weekly_plans WHERE employee_id=? AND week_start=?",
            (uid, week_start)
        ).fetchone())

        if not plan:
            return jsonify({"plan": None, "tasks": []})

        tasks = rows_to_list(db.execute(
            "SELECT wt.*, sg.title AS strategic_goal_title "
            "FROM weekly_tasks wt "
            "LEFT JOIN strategic_goals sg ON sg.id = wt.strategic_goal_id "
            "WHERE wt.plan_id=? ORDER BY wt.sort_order, wt.id",
            (plan["id"],)
        ).fetchall())

        return jsonify({"plan": plan, "tasks": tasks})
    finally:
        db.close()


@bp.post("/current")
@login_required
def update_current_plan():
    data = request.get_json(force=True) or {}
    tasks = data.get("tasks", [])

    db = get_db()
    try:
        uid = g.user.get("employee_id")
        week_start, week_end = _get_week_bounds()

        # Get or create plan
        plan = row_to_dict(db.execute(
            "SELECT * FROM weekly_plans WHERE employee_id=? AND week_start=?",
            (uid, week_start)
        ).fetchone())

        if not plan:
            cur = db.execute(
                "INSERT INTO weekly_plans (employee_id, week_start, week_end) VALUES (?,?,?)",
                (uid, week_start, week_end)
            )
            plan_id = cur.lastrowid
        else:
            plan_id = plan["id"]

        # Delete existing tasks and re-insert
        db.execute("DELETE FROM weekly_tasks WHERE plan_id=?", (plan_id,))

        # Validate any strategic-goal links upfront: only tasks the user was
        # actually assigned (individual scope) may be linked to a weekly plan.
        for task in tasks:
            sgid = task.get("strategic_goal_id")
            if not sgid:
                continue
            goal = db.execute(
                "SELECT scope, assigned_to_id, status FROM strategic_goals WHERE id=?",
                (sgid,),
            ).fetchone()
            if not goal:
                return jsonify({"error": "linked strategic goal not found"}), 400
            if goal["scope"] != "individual" or goal["assigned_to_id"] != uid:
                return jsonify({"error": (
                    "only goals assigned to you can be linked to your week")}), 400
            if goal["status"] == "cancelled":
                return jsonify({"error": "cancelled goals cannot be scheduled"}), 400

        for idx, task in enumerate(tasks):
            title = (task.get("title") or "").strip()
            if not title:
                continue
            status = task.get("status", "todo")
            if status not in TASK_STATUSES:
                status = "todo"
            day = task.get("day_of_week")
            if day not in (1, 2, 3, 4, 5):
                day = None
            db.execute(
                "INSERT INTO weekly_tasks (plan_id, title, status, strategic_goal_id, sort_order, day_of_week) "
                "VALUES (?,?,?,?,?,?)",
                (plan_id, title, status,
                 task.get("strategic_goal_id"), idx, day)
            )

        log_audit(db, "weekly_plan", plan_id, "update",
                  new_value={"tasks_count": len(tasks)})
        db.commit()

        return jsonify({"ok": True, "plan_id": plan_id})
    finally:
        db.close()


@bp.post("/<int:employee_id>/current")
@login_required
@roles_required(*SUPERVISOR_ROLES)
def update_member_plan(employee_id):
    """A supervisor (dept head / team leader) authors and assigns a member's
    weekly plan for the current week: the 'synthesize the quarterly plan into
    weeks and days' step. Tasks can carry the member's individual strategic
    goal (KPI-bearing) and a day-of-week; only goals assigned to that member
    can be scheduled, and only members inside the caller's scope are writable."""
    data = request.get_json(force=True) or {}
    tasks = data.get("tasks", [])
    db = get_db()
    try:
        uid = g.user.get("employee_id")
        role = g.user.get("role")
        week_start, week_end = _get_week_bounds()

        if employee_id != uid:
            scoped = {e["id"] for e in _scope_employees(db, role, uid)}
            if employee_id not in scoped:
                return jsonify({"error": "that employee is outside your scope"}), 403

        if not db.execute("SELECT id FROM employees WHERE id=?", (employee_id,)).fetchone():
            return jsonify({"error": "employee not found"}), 404

        plan = db.execute(
            "SELECT * FROM weekly_plans WHERE employee_id=? AND week_start=?",
            (employee_id, week_start)
        ).fetchone()
        if not plan:
            cur = db.execute(
                "INSERT INTO weekly_plans (employee_id, week_start, week_end) VALUES (?,?,?)",
                (employee_id, week_start, week_end)
            )
            plan_id = cur.lastrowid
        else:
            plan_id = plan["id"]

        db.execute("DELETE FROM weekly_tasks WHERE plan_id=?", (plan_id,))

        # Validate goal links: only individual tasks assigned to the member.
        for task in tasks:
            sgid = task.get("strategic_goal_id")
            if not sgid:
                continue
            goal = db.execute(
                "SELECT scope, assigned_to_id, status FROM strategic_goals WHERE id=?",
                (sgid,),
            ).fetchone()
            if not goal:
                return jsonify({"error": "linked strategic goal not found"}), 400
            if goal["scope"] != "individual" or goal["assigned_to_id"] != employee_id:
                return jsonify({"error": (
                    "only goals assigned to that member can be scheduled")}), 400
            if goal["status"] == "cancelled":
                return jsonify({"error": "cancelled goals cannot be scheduled"}), 400

        for idx, task in enumerate(tasks):
            title = (task.get("title") or "").strip()
            if not title:
                continue
            status = task.get("status", "todo")
            if status not in TASK_STATUSES:
                status = "todo"
            day = task.get("day_of_week")
            if day not in (1, 2, 3, 4, 5):
                day = None
            db.execute(
                "INSERT INTO weekly_tasks (plan_id, title, status, strategic_goal_id, sort_order, day_of_week) "
                "VALUES (?,?,?,?,?,?)",
                (plan_id, title, status,
                 task.get("strategic_goal_id"), idx, day)
            )

        log_audit(db, "weekly_plan", plan_id, "update",
                  new_value={"tasks_count": len(tasks), "assigned_by": uid})
        db.commit()

        return jsonify({"ok": True, "plan_id": plan_id, "employee_id": employee_id})
    finally:
        db.close()


@bp.post("/<int:plan_id>/tasks/<int:task_id>/toggle")
@login_required
def toggle_task(plan_id, task_id):
    db = get_db()
    try:
        uid = g.user.get("employee_id")

        # Verify ownership
        plan = db.execute(
            "SELECT * FROM weekly_plans WHERE id=? AND employee_id=?",
            (plan_id, uid)
        ).fetchone()
        if not plan:
            return jsonify({"error": "Not found or not your plan"}), 404

        task = db.execute(
            "SELECT * FROM weekly_tasks WHERE id=? AND plan_id=?",
            (task_id, plan_id)
        ).fetchone()
        if not task:
            return jsonify({"error": "Task not found"}), 404

        cycle = {"todo": "in_progress", "in_progress": "done", "done": "todo"}
        new_status = cycle.get(task["status"], "todo")
        db.execute(
            "UPDATE weekly_tasks SET status=? WHERE id=?",
            (new_status, task_id)
        )
        log_audit(db, "weekly_task", task_id, "update",
                  old_value={"status": task["status"]}, new_value={"status": new_status})
        db.commit()

        return jsonify({"ok": True, "status": new_status})
    finally:
        db.close()


@bp.post("/<int:plan_id>/tasks/<int:task_id>/status")
@login_required
def set_task_status(plan_id, task_id):
    """Set an explicit status (todo / in_progress / done) on a task."""
    data = request.get_json(force=True) or {}
    status = data.get("status")
    if status not in TASK_STATUSES:
        return jsonify({"error": "status must be one of: todo, in_progress, done"}), 400

    db = get_db()
    try:
        uid = g.user.get("employee_id")
        plan = db.execute(
            "SELECT * FROM weekly_plans WHERE id=? AND employee_id=?",
            (plan_id, uid)
        ).fetchone()
        if not plan:
            return jsonify({"error": "Not found or not your plan"}), 404

        task = db.execute(
            "SELECT * FROM weekly_tasks WHERE id=? AND plan_id=?",
            (task_id, plan_id)
        ).fetchone()
        if not task:
            return jsonify({"error": "Task not found"}), 404

        db.execute(
            "UPDATE weekly_tasks SET status=? WHERE id=?",
            (status, task_id)
        )
        log_audit(db, "weekly_task", task_id, "update",
                  old_value={"status": task["status"]}, new_value={"status": status})
        db.commit()
        return jsonify({"ok": True, "status": status})
    finally:
        db.close()


@bp.post("/<int:plan_id>/tasks/<int:task_id>/day")
@login_required
def set_task_day(plan_id, task_id):
    """Assign a task to a day of the week (1=Mon..5=Fri, or null)."""
    data = request.get_json(force=True) or {}
    day = data.get("day_of_week")
    if day is not None and day not in (1, 2, 3, 4, 5):
        return jsonify({"error": "day_of_week must be 1-5 or null"}), 400

    db = get_db()
    try:
        uid = g.user.get("employee_id")
        plan = db.execute(
            "SELECT * FROM weekly_plans WHERE id=? AND employee_id=?",
            (plan_id, uid)
        ).fetchone()
        if not plan:
            return jsonify({"error": "Not found or not your plan"}), 404
        task = db.execute(
            "SELECT * FROM weekly_tasks WHERE id=? AND plan_id=?",
            (task_id, plan_id)
        ).fetchone()
        if not task:
            return jsonify({"error": "Task not found"}), 404

        db.execute(
            "UPDATE weekly_tasks SET day_of_week=? WHERE id=?",
            (day, task_id)
        )
        log_audit(db, "weekly_task", task_id, "update",
                  old_value={"day_of_week": task["day_of_week"]}, new_value={"day_of_week": day})
        db.commit()
        return jsonify({"ok": True, "day_of_week": day})
    finally:
        db.close()


@bp.get("/today")
@login_required
def today_tasks():
    """The current user's tasks for today (by day_of_week). UNASSIGNED tasks are
    included so an employee can see everything still to do."""
    db = get_db()
    try:
        uid = g.user.get("employee_id")
        week_start, _week_end = _get_week_bounds()
        today_idx = datetime.now().date().isoweekday()  # 1=Mon..7=Sun

        plan = db.execute(
            "SELECT id FROM weekly_plans WHERE employee_id=? AND week_start=?",
            (uid, week_start)
        ).fetchone()
        if not plan:
            return jsonify({"today": [], "all_pending": [], "day": today_idx})

        tasks = rows_to_list(db.execute(
            "SELECT wt.*, sg.title AS strategic_goal_title "
            "FROM weekly_tasks wt "
            "LEFT JOIN strategic_goals sg ON sg.id = wt.strategic_goal_id "
            "WHERE wt.plan_id=? ORDER BY wt.sort_order, wt.id",
            (plan["id"],)
        ).fetchall())

        today = [t for t in tasks if t["day_of_week"] == today_idx or t["day_of_week"] is None]
        pending = [t for t in tasks if t["status"] != "done"]
        return jsonify({
            "today": today,
            "all_pending": pending,
            "day": today_idx,
            "day_name": _WEEKDAY_NAMES.get(today_idx, "Day"),
        })
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Summaries (supervisory)
# ---------------------------------------------------------------------------
def _scope_employees(db, role, uid):
    """Return the list of employees in the leader's scope, based on role/tier."""
    if role in ("admin", "executive"):
        return [dict(r) for r in db.execute(
            "SELECT id, full_name, department_id, position, manager_id "
            "FROM employees WHERE employment_status='active'").fetchall()]
    if role == "manager":
        # Legacy generic supervisor: direct reports only.
        return [dict(r) for r in db.execute(
            "SELECT id, full_name, department_id, position, manager_id "
            "FROM employees WHERE employment_status='active' AND manager_id=?", (uid,)).fetchall()]

    # Tier leaders: scope to their org subtree.
    me = db.execute(
        "SELECT department_id FROM employees WHERE id=?", (uid,)
    ).fetchone()
    if not me or not me["department_id"]:
        return []
    unit_ids = subtree_unit_ids(db, me["department_id"])
    return employees_in_units(db, unit_ids)


@bp.get("/summary")
@login_required
@roles_required(*SUPERVISOR_ROLES)
def team_summary():
    db = get_db()
    try:
        uid = g.user.get("employee_id")
        role = g.user.get("role")
        week_start, week_end = _get_week_bounds()

        employees = _scope_employees(db, role, uid)

        summaries = []
        for emp in employees:
            plan = row_to_dict(db.execute(
                "SELECT * FROM weekly_plans WHERE employee_id=? AND week_start=?",
                (emp["id"], week_start)
            ).fetchone())

            if plan:
                total = db.execute(
                    "SELECT COUNT(*) c FROM weekly_tasks WHERE plan_id=?",
                    (plan["id"],)
                ).fetchone()["c"]
                done = db.execute(
                    "SELECT COUNT(*) c FROM weekly_tasks WHERE plan_id=? AND status='done'",
                    (plan["id"],)
                ).fetchone()["c"]
                in_progress = db.execute(
                    "SELECT COUNT(*) c FROM weekly_tasks WHERE plan_id=? AND status='in_progress'",
                    (plan["id"],)
                ).fetchone()["c"]
                tasks = rows_to_list(db.execute(
                    "SELECT wt.*, sg.title AS strategic_goal_title "
                    "FROM weekly_tasks wt "
                    "LEFT JOIN strategic_goals sg ON sg.id = wt.strategic_goal_id "
                    "WHERE wt.plan_id=? ORDER BY wt.sort_order",
                    (plan["id"],)
                ).fetchall())
            else:
                total = 0
                done = 0
                in_progress = 0
                tasks = []

            summaries.append({
                "employee_id": emp["id"],
                "full_name": emp["full_name"],
                "department_id": emp["department_id"],
                "position": emp.get("position"),
                "total_tasks": total,
                "done_tasks": done,
                "in_progress_tasks": in_progress,
                "completion_pct": round(done / total * 100) if total > 0 else 0,
                "tasks": tasks,
            })

        return jsonify({
            "week_start": week_start,
            "week_end": week_end,
            "summaries": summaries,
        })
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Tier-scoped plan performance
# ---------------------------------------------------------------------------
def _tier_of(db, employee_id):
    """Return the leadership tier for an employee based on their unit level."""
    row = db.execute(
        "SELECT out.level_order FROM employees e "
        "JOIN departments d ON d.id = e.department_id "
        "LEFT JOIN org_unit_types out ON out.id = d.unit_type_id "
        "WHERE e.id = ?",
        (employee_id,),
    ).fetchone()
    if not row or row["level_order"] is None:
        return "employee"
    level = row["level_order"]
    if level <= 0:
        return "executive"
    if level == 1:
        return "director"
    if level == 2:
        return "dept_head"
    if level == 3:
        return "team_leader"
    return "employee"


@bp.get("/plan-performance")
@login_required
@roles_required(*SUPERVISOR_ROLES)
def plan_performance():
    db = get_db()
    try:
        uid = g.user.get("employee_id")
        role = g.user.get("role")
        week_start, week_end = _get_week_bounds()
        tier = _tier_of(db, uid)

        if role == "admin":
            tier = "executive"

        # Each tier sees only its own org subtree via _scope_employees.
        employees = _scope_employees(db, role, uid)

        summaries = []
        for emp in employees:
            plan = row_to_dict(db.execute(
                "SELECT * FROM weekly_plans WHERE employee_id=? AND week_start=?",
                (emp["id"], week_start)
            ).fetchone())
            if plan:
                total = db.execute(
                    "SELECT COUNT(*) c FROM weekly_tasks WHERE plan_id=?",
                    (plan["id"],)
                ).fetchone()["c"]
                done = db.execute(
                    "SELECT COUNT(*) c FROM weekly_tasks WHERE plan_id=? AND status='done'",
                    (plan["id"],)
                ).fetchone()["c"]
                tasks = rows_to_list(db.execute(
                    "SELECT wt.*, sg.title AS strategic_goal_title "
                    "FROM weekly_tasks wt "
                    "LEFT JOIN strategic_goals sg ON sg.id = wt.strategic_goal_id "
                    "WHERE wt.plan_id=? ORDER BY wt.sort_order",
                    (plan["id"],)
                ).fetchall())
            else:
                total = 0
                done = 0
                tasks = []
            summaries.append({
                "employee_id": emp["id"],
                "full_name": emp["full_name"],
                "department_id": emp["department_id"],
                "position": emp.get("position"),
                "total_tasks": total,
                "done_tasks": done,
                "completion_pct": round(done / total * 100) if total > 0 else 0,
                "tasks": tasks,
            })

        return jsonify({
            "tier": tier,
            "week_start": week_start,
            "week_end": week_end,
            "summaries": summaries,
        })
    finally:
        db.close()

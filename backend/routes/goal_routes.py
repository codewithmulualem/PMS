import json

from flask import Blueprint, request, jsonify, g

from database import get_db, rows_to_list, row_to_dict
from auth import login_required, roles_required, can_view_employee, SUPERVISOR_ROLES

bp = Blueprint("goal_routes", __name__, url_prefix="/api/goals")


def _log(db, entity_type, entity_id, action, old_value=None, new_value=None):
    db.execute(
        "INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value, changed_by) "
        "VALUES (?,?,?,?,?,?)",
        (entity_type, entity_id, action, json.dumps(old_value, default=str) if old_value else None,
         json.dumps(new_value, default=str) if new_value else None, g.user.get("username", "system")),
    )


@bp.get("")
@login_required
def list_goals():
    employee_id = request.args.get("employee_id", type=int)
    db = get_db()
    try:
        if employee_id:
            if not can_view_employee(g.user, employee_id):
                return jsonify({"error": "Forbidden"}), 403
            rows = db.execute("SELECT * FROM goals WHERE employee_id=? ORDER BY created_at DESC", (employee_id,)).fetchall()
        else:
            if g.user["role"] != "admin":
                return jsonify({"error": "employee_id required"}), 400
            rows = db.execute("SELECT * FROM goals ORDER BY created_at DESC").fetchall()
        return jsonify(rows_to_list(rows))
    finally:
        db.close()


@bp.post("")
@roles_required("admin", *SUPERVISOR_ROLES)
def create_goal():
    data = request.get_json(force=True) or {}
    required = ["employee_id", "title"]
    if any(not data.get(f) for f in required):
        return jsonify({"error": f"required: {required}"}), 400
    if g.user["role"] in SUPERVISOR_ROLES and not can_view_employee(g.user, data["employee_id"]):
        return jsonify({"error": "Forbidden: not your report"}), 403
    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO goals (employee_id, cycle_id, kpi_id, title, description, baseline, target_value, "
            "actual_value, measurement_unit, weight, priority, start_date, end_date, status, evidence_note) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                data["employee_id"], data.get("cycle_id"), data.get("kpi_id"), data["title"],
                data.get("description"), data.get("baseline", 0), data.get("target_value"),
                data.get("actual_value", 0), data.get("measurement_unit"), data.get("weight", 0),
                data.get("priority", "medium"), data.get("start_date"), data.get("end_date"),
                data.get("status", "in_progress"), data.get("evidence_note"),
            ),
        )
        _log(db, "goal", cur.lastrowid, "create", new_value=data)
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201
    finally:
        db.close()


@bp.put("/<int:goal_id>")
@login_required
def update_goal(goal_id):
    data = request.get_json(force=True) or {}
    db = get_db()
    try:
        goal = db.execute("SELECT * FROM goals WHERE id=?", (goal_id,)).fetchone()
        if not goal:
            return jsonify({"error": "Not found"}), 404

        is_owner = g.user["employee_id"] == goal["employee_id"]
        is_manager = g.user["role"] in SUPERVISOR_ROLES and can_view_employee(g.user, goal["employee_id"])
        is_admin = g.user["role"] == "admin"
        if not (is_owner or is_manager or is_admin):
            return jsonify({"error": "Forbidden"}), 403

        # employees may only update progress fields on their own goals
        if is_owner and not (is_manager or is_admin):
            allowed = {"actual_value", "status", "evidence_note"}
        else:
            allowed = {"title", "description", "baseline", "target_value", "actual_value",
                       "measurement_unit", "weight", "priority", "start_date", "end_date",
                       "status", "evidence_note", "kpi_id", "cycle_id"}
        updates = {k: v for k, v in data.items() if k in allowed}
        if updates:
            set_clause = ", ".join(f"{k}=?" for k in updates) + ", updated_at=datetime('now')"
            db.execute(f"UPDATE goals SET {set_clause} WHERE id=?", (*updates.values(), goal_id))
            _log(db, "goal", goal_id, "update", old_value=row_to_dict(goal), new_value=updates)
            db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()

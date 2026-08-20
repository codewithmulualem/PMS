import json

from flask import Blueprint, request, jsonify, g

from database import get_db, rows_to_list, row_to_dict
from auth import login_required, roles_required, can_view_employee

bp = Blueprint("kpi_routes", __name__, url_prefix="/api/kpis")


def _log(db, entity_type, entity_id, action, old_value=None, new_value=None):
    db.execute(
        "INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value, changed_by) "
        "VALUES (?,?,?,?,?,?)",
        (entity_type, entity_id, action, json.dumps(old_value, default=str) if old_value else None,
         json.dumps(new_value, default=str) if new_value else None, g.user.get("username", "system")),
    )


@bp.get("")
@login_required
def list_kpis():
    employee_id = request.args.get("employee_id", type=int)
    db = get_db()
    try:
        if employee_id:
            if not can_view_employee(g.user, employee_id):
                return jsonify({"error": "Forbidden"}), 403
            rows = db.execute("SELECT * FROM kpis WHERE employee_id=? ORDER BY created_at DESC", (employee_id,)).fetchall()
        else:
            if g.user["role"] != "admin":
                return jsonify({"error": "employee_id required"}), 400
            rows = db.execute("SELECT * FROM kpis ORDER BY created_at DESC").fetchall()
        return jsonify(rows_to_list(rows))
    finally:
        db.close()


@bp.post("")
@roles_required("admin", "manager")
def create_kpi():
    data = request.get_json(force=True) or {}
    required = ["employee_id", "name"]
    if any(not data.get(f) for f in required):
        return jsonify({"error": f"required: {required}"}), 400
    if g.user["role"] == "manager" and not can_view_employee(g.user, data["employee_id"]):
        return jsonify({"error": "Forbidden: not your report"}), 403
    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO kpis (employee_id, cycle_id, name, definition, measurement_unit, target_value, "
            "min_acceptable_value, stretch_value, actual_value, weight, direction, frequency) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                data["employee_id"], data.get("cycle_id"), data["name"], data.get("definition"),
                data.get("measurement_unit"), data.get("target_value"), data.get("min_acceptable_value"),
                data.get("stretch_value"), data.get("actual_value"), data.get("weight", 0),
                data.get("direction", "higher_is_better"), data.get("frequency", "quarterly"),
            ),
        )
        _log(db, "kpi", cur.lastrowid, "create", new_value=data)
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201
    finally:
        db.close()


@bp.put("/<int:kpi_id>")
@roles_required("admin", "manager")
def update_kpi(kpi_id):
    data = request.get_json(force=True) or {}
    db = get_db()
    try:
        kpi = db.execute("SELECT * FROM kpis WHERE id=?", (kpi_id,)).fetchone()
        if not kpi:
            return jsonify({"error": "Not found"}), 404
        if g.user["role"] == "manager" and not can_view_employee(g.user, kpi["employee_id"]):
            return jsonify({"error": "Forbidden"}), 403
        fields = ["name", "definition", "measurement_unit", "target_value", "min_acceptable_value",
                  "stretch_value", "actual_value", "weight", "direction", "frequency", "cycle_id"]
        updates = {f: data[f] for f in fields if f in data}
        if updates:
            set_clause = ", ".join(f"{k}=?" for k in updates)
            db.execute(f"UPDATE kpis SET {set_clause} WHERE id=?", (*updates.values(), kpi_id))
            _log(db, "kpi", kpi_id, "update", old_value=row_to_dict(kpi), new_value=updates)
            db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()

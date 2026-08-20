import json

from flask import Blueprint, request, jsonify, g

from database import get_db, rows_to_list, row_to_dict
from auth import login_required, roles_required, can_view_employee

bp = Blueprint("competency_routes", __name__, url_prefix="/api")


def _log(db, entity_type, entity_id, action, old_value=None, new_value=None):
    db.execute(
        "INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value, changed_by) "
        "VALUES (?,?,?,?,?,?)",
        (entity_type, entity_id, action, json.dumps(old_value, default=str) if old_value else None,
         json.dumps(new_value, default=str) if new_value else None, g.user.get("username", "system")),
    )


@bp.get("/competencies")
@login_required
def list_competencies():
    db = get_db()
    try:
        return jsonify(rows_to_list(db.execute("SELECT * FROM competencies ORDER BY category, name").fetchall()))
    finally:
        db.close()


@bp.post("/competencies")
@roles_required("admin")
def create_competency():
    data = request.get_json(force=True) or {}
    if not data.get("name"):
        return jsonify({"error": "name required"}), 400
    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO competencies (name, category, definition) VALUES (?,?,?)",
            (data["name"], data.get("category", "technical"), data.get("definition")),
        )
        _log(db, "competency", cur.lastrowid, "create", new_value=data)
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201
    finally:
        db.close()


@bp.get("/employee-competencies")
@login_required
def list_employee_competencies():
    employee_id = request.args.get("employee_id", type=int)
    if not employee_id or not can_view_employee(g.user, employee_id):
        return jsonify({"error": "Forbidden"}), 403
    db = get_db()
    try:
        rows = db.execute(
            "SELECT ec.*, c.name as competency_name, c.category FROM employee_competencies ec "
            "JOIN competencies c ON c.id = ec.competency_id WHERE ec.employee_id=?",
            (employee_id,),
        ).fetchall()
        return jsonify(rows_to_list(rows))
    finally:
        db.close()


@bp.post("/employee-competencies")
@roles_required("admin", "manager")
def upsert_employee_competency():
    data = request.get_json(force=True) or {}
    required = ["employee_id", "competency_id"]
    if any(not data.get(f) for f in required):
        return jsonify({"error": f"required: {required}"}), 400
    if g.user["role"] == "manager" and not can_view_employee(g.user, data["employee_id"]):
        return jsonify({"error": "Forbidden"}), 403
    db = get_db()
    try:
        existing = db.execute(
            "SELECT id FROM employee_competencies WHERE employee_id=? AND competency_id=?",
            (data["employee_id"], data["competency_id"]),
        ).fetchone()
        if existing:
            db.execute(
                "UPDATE employee_competencies SET current_level=?, target_level=?, evidence_note=?, "
                "updated_at=datetime('now') WHERE id=?",
                (data.get("current_level", 0), data.get("target_level", 0), data.get("evidence_note"), existing["id"]),
            )
            _log(db, "employee_competency", existing["id"], "update", new_value=data)
            db.commit()
            return jsonify({"id": existing["id"]})
        else:
            cur = db.execute(
                "INSERT INTO employee_competencies (employee_id, competency_id, current_level, target_level, evidence_note) "
                "VALUES (?,?,?,?,?)",
                (data["employee_id"], data["competency_id"], data.get("current_level", 0),
                 data.get("target_level", 0), data.get("evidence_note")),
            )
            _log(db, "employee_competency", cur.lastrowid, "create", new_value=data)
            db.commit()
            return jsonify({"id": cur.lastrowid}), 201
    finally:
        db.close()

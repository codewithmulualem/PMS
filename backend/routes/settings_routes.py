import json

from flask import Blueprint, request, jsonify, g

from database import get_db, row_to_dict
from auth import roles_required

bp = Blueprint("settings_routes", __name__, url_prefix="/api")


@bp.get("/weights")
@roles_required("admin", "executive")
def get_weights():
    cycle_id = request.args.get("cycle_id", type=int)
    db = get_db()
    try:
        row = db.execute("SELECT * FROM score_weights WHERE cycle_id=?", (cycle_id,)).fetchone() if cycle_id else None
        if not row:
            row = db.execute("SELECT * FROM score_weights WHERE cycle_id IS NULL").fetchone()
        return jsonify(row_to_dict(row))
    finally:
        db.close()


@bp.put("/weights")
@roles_required("admin")
def update_weights():
    data = request.get_json(force=True) or {}
    cycle_id = data.get("cycle_id")
    fields = ["kpi_weight", "goal_weight", "competency_weight", "behavior_weight", "program_weight"]
    weights = {f: data.get(f) for f in fields if data.get(f) is not None}
    if not weights:
        return jsonify({"error": "no weights provided"}), 400
    try:
        weights = {key: float(value) for key, value in weights.items()}
    except (TypeError, ValueError):
        return jsonify({"error": "weights must be numeric"}), 400
    if any(value < 0 or value > 100 for value in weights.values()):
        return jsonify({"error": "weights must be between 0 and 100"}), 400
    total = sum(weights.values())
    if abs(total - 100.0) > 1e-6:
        return jsonify({"error": f"weights must sum to 100% (got {round(total, 3)})"}), 400

    db = get_db()
    try:
        target = "cycle_id = ?" if cycle_id else "cycle_id IS NULL"
        existing = db.execute(
            f"SELECT id FROM score_weights WHERE {target}", (cycle_id,) if cycle_id else ()
        ).fetchone()
        if existing:
            set_clause = ", ".join(f"{k}=?" for k in weights)
            db.execute(f"UPDATE score_weights SET {set_clause} WHERE id=?", (*weights.values(), existing["id"]))
        else:
            cols = ["cycle_id"] + list(weights.keys())
            marks = ",".join("?" * len(cols))
            db.execute(
                f"INSERT INTO score_weights ({', '.join(cols)}) VALUES ({marks})",
                ([cycle_id] + list(weights.values())),
            )
        db.execute(
            "INSERT INTO audit_log (entity_type, entity_id, action, new_value, changed_by, reason) "
            "VALUES ('score_weights', ?, 'update', ?, ?, 'weights configuration')",
            (cycle_id or 0, json.dumps(weights), g.user.get("username", "system")),
        )
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()

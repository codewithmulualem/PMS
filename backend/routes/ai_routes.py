from flask import Blueprint, request, jsonify, g

from auth import login_required, roles_required, can_view_employee
from ai_engine import generate_insights, detect_anomalies

bp = Blueprint("ai_routes", __name__, url_prefix="/api/ai")


@bp.post("/employees/<int:employee_id>/insights")
@login_required
def create_insights(employee_id):
    if not can_view_employee(g.user, employee_id):
        return jsonify({"error": "Forbidden"}), 403
    cycle_id = request.get_json(silent=True) and request.get_json().get("cycle_id")
    if not cycle_id:
        return jsonify({"error": "cycle_id required"}), 400
    insights = generate_insights(employee_id, cycle_id)
    return jsonify(insights)


@bp.get("/anomalies")
@roles_required("admin")
def anomalies():
    cycle_id = request.args.get("cycle_id", type=int)
    if not cycle_id:
        return jsonify({"error": "cycle_id required"}), 400
    return jsonify(detect_anomalies(cycle_id))

from flask import Blueprint, request, jsonify, g

from database import get_db, rows_to_list, row_to_dict
from auth import login_required, roles_required, can_view_employee
from scoring import calculate_employee_score
from config import get_setting

bp = Blueprint("dashboard_routes", __name__, url_prefix="/api")


def _current_cycle_id(db):
    row = db.execute("SELECT id FROM performance_cycles WHERE status='active' ORDER BY start_date DESC LIMIT 1").fetchone()
    return row["id"] if row else None


def _team_average(db, manager_id, cycle_id):
    """Average score of a manager's scored direct reports in the given cycle."""
    reports = db.execute("SELECT id FROM employees WHERE manager_id=?", (manager_id,)).fetchall()
    ids = [r["id"] for r in reports]
    if not ids:
        return None
    placeholders = ",".join("?" * len(ids))
    row = db.execute(
        f"SELECT AVG(overall_score) a FROM performance_scores WHERE cycle_id=? AND employee_id IN ({placeholders})",
        (cycle_id, *ids),
    ).fetchone()
    return round(row["a"], 2) if row and row["a"] is not None else None


def _org_average(db, cycle_id):
    row = db.execute(
        "SELECT AVG(overall_score) a FROM performance_scores WHERE cycle_id=?", (cycle_id,)
    ).fetchone()
    return round(row["a"], 2) if row and row["a"] is not None else None


@bp.get("/employees/<int:employee_id>/dashboard")
@login_required
def employee_dashboard(employee_id):
    if not can_view_employee(g.user, employee_id):
        return jsonify({"error": "Forbidden"}), 403
    db = get_db()
    try:
        cycle_id = request.args.get("cycle_id", type=int) or _current_cycle_id(db)
        employee = row_to_dict(db.execute(
            "SELECT e.*, d.name AS department_name FROM employees e "
            "LEFT JOIN departments d ON d.id = e.department_id WHERE e.id = ?",
            (employee_id,)).fetchone())
        if not employee:
            return jsonify({"error": "Not found"}), 404

        score = calculate_employee_score(employee_id, cycle_id, persist=True, db=db) if cycle_id else None

        goals = rows_to_list(db.execute(
            "SELECT * FROM goals WHERE employee_id=? AND (cycle_id=? OR cycle_id IS NULL) ORDER BY end_date",
            (employee_id, cycle_id)).fetchall())
        kpis = rows_to_list(db.execute(
            "SELECT * FROM kpis WHERE employee_id=? AND (cycle_id=? OR cycle_id IS NULL)",
            (employee_id, cycle_id)).fetchall())
        competencies = rows_to_list(db.execute(
            "SELECT ec.*, c.name as competency_name, c.category FROM employee_competencies ec "
            "JOIN competencies c ON c.id = ec.competency_id WHERE ec.employee_id=? ORDER BY c.category, c.name",
            (employee_id,)).fetchall())
        history = rows_to_list(db.execute(
            "SELECT ps.*, pc.name as cycle_name FROM performance_scores ps "
            "JOIN performance_cycles pc ON pc.id = ps.cycle_id WHERE ps.employee_id=? ORDER BY pc.start_date",
            (employee_id,)).fetchall())
        insights = rows_to_list(db.execute(
            "SELECT * FROM ai_insights WHERE employee_id=? AND (cycle_id=? OR cycle_id IS NULL) ORDER BY created_at DESC LIMIT 10",
            (employee_id, cycle_id)).fetchall())
        evaluations = rows_to_list(db.execute(
            "SELECT e.*, u.username as evaluator_username FROM evaluations e "
            "LEFT JOIN users u ON u.employee_id = e.evaluator_id "
            "WHERE e.employee_id=? AND (e.cycle_id=? OR e.cycle_id IS NULL) ORDER BY e.id DESC",
            (employee_id, cycle_id)).fetchall())

        # 360 form workflow results: every evaluation_assignments row for this
        # subject in the cycle, so the subject and any permitted viewer can see
        # the per-perspective scores and the combined overall score.
        evaluation_results = rows_to_list(db.execute(
            "SELECT a.id, a.form_id, f.name AS form_name, a.evaluator_type, "
            "a.evaluator_id, ev.full_name AS evaluator_name, a.status, a.score, "
            "a.max_score, a.overall_score, a.submitted_at, a.finalized_at "
            "FROM evaluation_assignments a "
            "JOIN evaluation_forms f ON f.id = a.form_id "
            "LEFT JOIN employees ev ON ev.id = a.evaluator_id "
            "WHERE a.employee_id=? AND (a.cycle_id=? OR a.cycle_id IS NULL) "
            "ORDER BY a.id DESC",
            (employee_id, cycle_id)).fetchall())

        previous_score = None
        if history and len(history) > 1 and history[-1].get("cycle_id") == cycle_id:
            previous_score = history[-2].get("overall_score")
        elif history and history[-1].get("cycle_id") != cycle_id:
            previous_score = history[-1].get("overall_score")

        team_avg = _team_average(db, employee.get("manager_id"), cycle_id) if employee.get("manager_id") else None
        org_avg = _org_average(db, cycle_id)

        return jsonify({
            "employee": employee,
            "cycle_id": cycle_id,
            "score": score,
            "previous_score": previous_score,
            "benchmarks": {"team_average": team_avg, "organization_average": org_avg},
            "goals": goals,
            "kpis": kpis,
            "competencies": competencies,
            "history": history,
            "evaluations": evaluations,
            "evaluation_results": evaluation_results,
            "insights": insights,
        })
    finally:
        db.close()


@bp.get("/managers/<int:manager_id>/team-dashboard")
@login_required
def manager_dashboard(manager_id):
    MANAGE_ROLES = ("admin", "director", "dept_head", "team_leader", "manager", "executive")
    if g.user["role"] not in MANAGE_ROLES or (
        g.user["role"] in ("director", "dept_head", "team_leader", "manager", "executive") and g.user["employee_id"] != manager_id
    ):
        return jsonify({"error": "Forbidden"}), 403
    db = get_db()
    try:
        cycle_id = request.args.get("cycle_id", type=int) or _current_cycle_id(db)
        reports = rows_to_list(db.execute("SELECT * FROM employees WHERE manager_id=?", (manager_id,)).fetchall())

        team = []
        for r in reports:
            score = calculate_employee_score(r["id"], cycle_id, persist=True, db=db) if cycle_id else None
            goals_open = db.execute(
                "SELECT COUNT(*) c FROM goals WHERE employee_id=? AND status IN ('in_progress','at_risk','not_started')",
                (r["id"],)).fetchone()["c"]
            goals_at_risk = db.execute(
                "SELECT COUNT(*) c FROM goals WHERE employee_id=? AND status='at_risk'", (r["id"],)).fetchone()["c"]
            evals = rows_to_list(db.execute(
                "SELECT * FROM evaluations WHERE employee_id=? AND cycle_id=?",
                (r["id"], cycle_id)).fetchall()) if cycle_id else []
            eval_types = {e["evaluator_type"] for e in evals}
            manager_eval = next((e for e in evals if e["evaluator_type"] == "manager"), None)
            team.append({
                "employee": r,
                "overall_score": score["overall_score"] if score else None,
                "rating": score["rating"] if score else None,
                "open_goals": goals_open,
                "at_risk_goals": goals_at_risk,
                "manager_evaluation_submitted": "manager" in eval_types,
                "self_assessment_submitted": "self" in eval_types,
                "manager_evaluation": manager_eval,
            })

        scored = [t for t in team if t["overall_score"] is not None]
        avg_score = round(sum(t["overall_score"] for t in scored) / len(scored), 2) if scored else None
        high_threshold = get_setting(db, "performance.high_threshold", "80", cast=float)
        at_risk_threshold = get_setting(db, "performance.at_risk_threshold", "60", cast=float)
        high_performers = sorted([t for t in scored if t["overall_score"] >= high_threshold],
                                 key=lambda t: -t["overall_score"])
        at_risk = [t for t in team
                   if t["at_risk_goals"] > 0
                   or (t["overall_score"] is not None and t["overall_score"] < at_risk_threshold)]

        distribution = rows_to_list(db.execute(
            "SELECT rating_label, COUNT(*) as count FROM performance_scores WHERE cycle_id=? "
            "AND employee_id IN (SELECT id FROM employees WHERE manager_id=?) GROUP BY rating_label",
            (cycle_id, manager_id)).fetchall()) if cycle_id else []

        return jsonify({
            "manager_id": manager_id,
            "cycle_id": cycle_id,
            "team_size": len(reports),
            "average_score": avg_score,
            "organization_average": _org_average(db, cycle_id) if cycle_id else None,
            "rating_distribution": distribution,
            "team": team,
            "high_performers": high_performers,
            "employees_needing_attention": at_risk,
            "evaluations_pending": len([t for t in team if not t["manager_evaluation_submitted"]]),
        })
    finally:
        db.close()


@bp.get("/executive/overview")
@roles_required("admin", "executive")
def executive_overview():
    db = get_db()
    try:
        cycle_id = request.args.get("cycle_id", type=int) or _current_cycle_id(db)
        by_dept = rows_to_list(db.execute(
            "SELECT d.id as department_id, d.name as department, COUNT(e.id) as headcount, "
            "AVG(ps.overall_score) as avg_score "
            "FROM departments d LEFT JOIN employees e ON e.department_id = d.id "
            "LEFT JOIN performance_scores ps ON ps.employee_id = e.id AND ps.cycle_id = ? "
            "GROUP BY d.id ORDER BY d.name", (cycle_id,)).fetchall())

        distribution = rows_to_list(db.execute(
            "SELECT rating_label, COUNT(*) as count FROM performance_scores WHERE cycle_id=? GROUP BY rating_label",
            (cycle_id,)).fetchall())

        org_avg_row = db.execute(
            "SELECT AVG(overall_score) as avg_score, COUNT(*) as n FROM performance_scores WHERE cycle_id=?",
            (cycle_id,)).fetchone()

        top_kpis = rows_to_list(db.execute(
            "SELECT name, AVG(CASE WHEN direction='higher_is_better' THEN (actual_value*1.0/NULLIF(target_value,0))*100 "
            "ELSE (target_value*1.0/NULLIF(actual_value,0))*100 END) as avg_achievement "
            "FROM kpis WHERE cycle_id=? OR cycle_id IS NULL GROUP BY name ORDER BY avg_achievement ASC LIMIT 5",
            (cycle_id,)).fetchall())

        trend = rows_to_list(db.execute(
            "SELECT pc.name as cycle_name, pc.start_date, AVG(ps.overall_score) as avg_score "
            "FROM performance_scores ps JOIN performance_cycles pc ON pc.id = ps.cycle_id "
            "GROUP BY pc.id ORDER BY pc.start_date").fetchall())

        return jsonify({
            "cycle_id": cycle_id,
            "organization_average_score": round(org_avg_row["avg_score"], 2) if org_avg_row["avg_score"] else None,
            "employees_scored": org_avg_row["n"],
            "by_department": by_dept,
            "rating_distribution": distribution,
            "lowest_achieving_kpis": top_kpis,
            "org_trend": trend,
        })
    finally:
        db.close()


@bp.get("/departments/<int:department_id>/employees")
@login_required
def department_employees(department_id):
    """Drill-down from an organizational unit to its people (admin/executive/read-only)."""
    if g.user["role"] not in ("admin", "executive"):
        return jsonify({"error": "Forbidden"}), 403
    db = get_db()
    try:
        rows = rows_to_list(db.execute(
            "SELECT e.*, m.full_name as manager_name FROM employees e "
            "LEFT JOIN employees m ON m.id = e.manager_id WHERE e.department_id=? ORDER BY e.full_name",
            (department_id,)).fetchall())
        return jsonify(rows)
    finally:
        db.close()

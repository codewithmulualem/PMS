import json

from flask import Blueprint, request, jsonify, g

from database import get_db, rows_to_list, row_to_dict
from auth import login_required, can_view_employee

bp = Blueprint("evaluation_routes", __name__, url_prefix="/api")


def _log(db, entity_type, entity_id, action, old_value=None, new_value=None):
    db.execute(
        "INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value, changed_by) "
        "VALUES (?,?,?,?,?,?)",
        (entity_type, entity_id, action, json.dumps(old_value, default=str) if old_value else None,
         json.dumps(new_value, default=str) if new_value else None, g.user.get("username", "system")),
    )


def _check_evaluator_allowed(data, evaluator_type, db):
    """Enforces who may act as which evaluator type."""
    if evaluator_type not in ("self", "manager", "peer", "subordinate"):
        return "evaluator_type must be self, manager, peer, or subordinate"
    employee_id = data["employee_id"]
    if not db.execute("SELECT 1 FROM employees WHERE id=?", (employee_id,)).fetchone():
        return "target employee not found"
    if evaluator_type == "self" and g.user["employee_id"] != employee_id:
        return "Only the employee can submit their own self-assessment"
    if evaluator_type == "manager":
        if g.user["role"] not in ("director", "dept_head", "team_leader", "manager", "admin", "executive"):
            return "Forbidden: only managers may submit manager assessments"
        if g.user["role"] in ("director", "dept_head", "team_leader", "manager") and not can_view_employee(g.user, employee_id, db=db):
            return "Forbidden: not your report"
        # Admins/executives may review their direct reports or any top-of-tree
        # leader (manager_id is NULL). The latter keeps cross-review of the org
        # head / CEO possible while scoping everything else to the report chain.
        if g.user["role"] in ("admin", "executive"):
            row = db.execute(
                "SELECT manager_id FROM employees WHERE id=?", (employee_id,)
            ).fetchone()
            if not row:
                return "Forbidden: target employee not found"
            is_report = row["manager_id"] == g.user.get("employee_id")
            is_top_of_tree = row["manager_id"] is None
            if not (is_report or is_top_of_tree):
                return "Forbidden: can only evaluate your direct reports or top-of-tree leaders"
    if evaluator_type == "subordinate":
        if g.user["role"] not in ("director", "dept_head", "team_leader", "manager", "admin", "executive"):
            return "Forbidden: insufficient role for subordinate assessment"
        if g.user["role"] in ("director", "dept_head", "team_leader", "manager"):
            if not can_view_employee(g.user, employee_id, db=db):
                return "Forbidden: target is outside your reporting scope"
            subordinate = db.execute(
                "SELECT manager_id FROM employees WHERE id=?", (employee_id,)
            ).fetchone()
            if not subordinate or subordinate["manager_id"] != g.user.get("employee_id"):
                return "Forbidden: target is not your direct subordinate"
        elif g.user["role"] in ("admin", "executive"):
            target = db.execute("SELECT id FROM employees WHERE id=?", (employee_id,)).fetchone()
            if not target:
                return "Forbidden: target employee not found"
    return None


def _validated_score(value, field):
    if value is None or value == "":
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field} must be numeric")
    if not 0 <= numeric <= 100:
        raise ValueError(f"{field} must be between 0 and 100")
    return numeric


def _validated_status(value):
    status = value or "submitted"
    if status not in ("draft", "submitted", "rejected"):
        raise ValueError("status must be draft, submitted, or rejected")
    return status


@bp.get("/evaluations")
@login_required
def list_evaluations():
    employee_id = request.args.get("employee_id", type=int)
    if not employee_id or not can_view_employee(g.user, employee_id):
        return jsonify({"error": "Forbidden"}), 403
    db = get_db()
    try:
        rows = db.execute(
            "SELECT * FROM evaluations WHERE employee_id=? ORDER BY id DESC", (employee_id,)
        ).fetchall()
        return jsonify(rows_to_list(rows))
    finally:
        db.close()


@bp.post("/evaluations")
@login_required
def submit_evaluation():
    data = request.get_json(force=True) or {}
    required = ["employee_id", "cycle_id", "evaluator_type"]
    if any(not data.get(f) for f in required):
        return jsonify({"error": f"required: {required}"}), 400

    db = get_db()
    try:
        try:
            behavior_score = _validated_score(data.get("behavior_score"), "behavior_score")
            program_score = _validated_score(data.get("program_score", data.get("project_score")), "program_score")
            status = _validated_status(data.get("status"))
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        blocked = _check_evaluator_allowed(data, data["evaluator_type"], db)
        if blocked:
            return jsonify({"error": blocked}), 403
        # Upsert: one evaluation per (employee, cycle, evaluator, type).
        existing = db.execute(
            "SELECT id FROM evaluations WHERE employee_id=? AND cycle_id=? AND evaluator_id=? AND evaluator_type=?",
            (data["employee_id"], data["cycle_id"], g.user.get("employee_id"), data["evaluator_type"]),
        ).fetchone()
        if existing:
            db.execute(
                "UPDATE evaluations SET behavior_score=?, program_score=?, comments=?, "
                "status=?, submitted_at=datetime('now') WHERE id=?",
                (behavior_score, program_score, data.get("comments"), status, existing["id"]),
            )
            _log(db, "evaluation", existing["id"], "update", new_value=data)
            db.commit()
            return jsonify({"id": existing["id"]})
        cur = db.execute(
            "INSERT INTO evaluations (employee_id, cycle_id, evaluator_id, evaluator_type, behavior_score, "
            "program_score, comments, status, submitted_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))",
            (
                data["employee_id"], data["cycle_id"], g.user.get("employee_id"), data["evaluator_type"],
                behavior_score, program_score, data.get("comments"), status,
            ),
        )
        _log(db, "evaluation", cur.lastrowid, "create", new_value=data)
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201
    finally:
        db.close()


@bp.put("/evaluations/<int:evaluation_id>")
@login_required
def update_evaluation(evaluation_id):
    data = request.get_json(force=True) or {}
    db = get_db()
    try:
        row = db.execute("SELECT * FROM evaluations WHERE id=?", (evaluation_id,)).fetchone()
        if not row:
            return jsonify({"error": "Not found"}), 404
        is_owner = row["evaluator_id"] == g.user.get("employee_id")
        is_admin = g.user["role"] in ("admin", "executive")
        if not (is_owner or is_admin):
            return jsonify({"error": "Forbidden"}), 403
        fields = ["behavior_score", "program_score", "project_score", "comments", "status"]
        updates = {f: data[f] for f in fields if f in data}
        try:
            if "behavior_score" in updates:
                updates["behavior_score"] = _validated_score(updates["behavior_score"], "behavior_score")
            if "project_score" in updates and "program_score" not in updates:
                updates["program_score"] = updates.pop("project_score")
            if "program_score" in updates:
                updates["program_score"] = _validated_score(updates["program_score"], "program_score")
            if "status" in updates:
                updates["status"] = _validated_status(updates["status"])
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        if updates:
            set_clause = ", ".join(f"{k}=?" for k in updates) + ", submitted_at=datetime('now')"
            db.execute(f"UPDATE evaluations SET {set_clause} WHERE id=?", (*updates.values(), evaluation_id))
            _log(db, "evaluation", evaluation_id, "update", old_value=row_to_dict(row), new_value=updates)
            db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


@bp.get("/managers/<int:manager_id>/evaluations")
@login_required
def manager_evaluations(manager_id):
    EVAL_ROLES = ("admin", "director", "dept_head", "team_leader", "executive")
    if g.user["role"] not in EVAL_ROLES or (
        g.user["role"] in ("director", "dept_head", "team_leader", "executive") and g.user["employee_id"] != manager_id
    ):
        return jsonify({"error": "Forbidden"}), 403
    db = get_db()
    try:
        reports = db.execute("SELECT * FROM employees WHERE manager_id=?", (manager_id,)).fetchall()
        result = []
        for r in reports:
            evals = rows_to_list(db.execute(
                "SELECT e.*, u.username as evaluator_username FROM evaluations e "
                "LEFT JOIN users u ON u.employee_id = e.evaluator_id "
                "WHERE e.employee_id=? ORDER BY e.id DESC", (r["id"],)).fetchall())
            manager_eval = next((e for e in evals if e["evaluator_type"] == "manager"), None)
            self_eval = next((e for e in evals if e["evaluator_type"] == "self"), None)
            result.append({
                "employee": row_to_dict(r),
                "evaluations": evals,
                "manager_evaluation_submitted": manager_eval is not None,
                "self_assessment_submitted": self_eval is not None,
            })
        return jsonify(result)
    finally:
        db.close()

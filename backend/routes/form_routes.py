"""
Evaluation form workflow (360 support).

A form template has sections grouped by evaluator perspective (self, manager,
peer). Assigning a form to an employee creates one assignment per perspective:
the subject's own self review, their manager's review, and any peer reviews.
Each assignment is filled and submitted independently by its evaluator, then
approved up the subject's reporting chain (approval_levels). The final approval
computes that perspective's score; the subject's overall 360 score renormalizes
across every scored perspective by the form's perspective weights.

Every transition is appended to the audit log.
"""

import json

from flask import Blueprint, request, jsonify, g

from database import get_db, rows_to_list, row_to_dict
from auth import login_required, roles_required
from scoring import weighted_average

bp = Blueprint("form_routes", __name__, url_prefix="/api")

ALLOWED_KINDS = ("rating", "scale", "text", "select", "multi")
PERSPECTIVES = ("self", "manager", "peer")
DEFAULT_OPTIONS = ["Option 1", "Option 2", "Option 3"]


def _log(db, entity_type, entity_id, action, old_value=None, new_value=None, reason=None):
    db.execute(
        "INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value, changed_by, reason) "
        "VALUES (?,?,?,?,?,?,?)",
        (entity_type, entity_id, action,
         json.dumps(old_value, default=str) if old_value else None,
         json.dumps(new_value, default=str) if new_value else None,
         g.user.get("username", "system"), reason),
    )


def _approver_for_level(db, employee_id, level):
    """The employee id that approves at the given level (1 = immediate manager)."""
    cur = employee_id
    for _ in range(level):
        row = db.execute("SELECT manager_id FROM employees WHERE id=?", (cur,)).fetchone()
        if not row or not row["manager_id"]:
            return None
        cur = row["manager_id"]
    return cur


def _chain_depth(db, employee_id):
    """Consecutive managers above `employee_id` (0 = no manager, i.e. an apex
    employee). This is the depth used to derive an employee's approval levels."""
    seen = set()
    cur = employee_id
    depth = 0
    while cur is not None and cur not in seen and depth < 20:
        seen.add(cur)
        row = db.execute("SELECT manager_id FROM employees WHERE id=?", (cur,)).fetchone()
        if not row or not row["manager_id"]:
            break
        cur = row["manager_id"]
        depth += 1
    return depth


def _top_executive_ids(db):
    """Apex employees (no manager above them). When the approval chain reaches
    the top of the hierarchy, every top executive must co-approve the level."""
    rows = db.execute(
        "SELECT id FROM employees WHERE manager_id IS NULL AND employment_status='active' "
        "ORDER BY id").fetchall()
    return [r["id"] for r in rows]


def _effective_levels(db, employee_id, form_levels):
    """How many approval levels this employee actually needs: the form's cap
    clamped to their depth in the org hierarchy. Leaves get more approvals than
    the root, which may get none."""
    depth = _chain_depth(db, employee_id)
    if not form_levels:
        return depth
    return min(int(form_levels), depth)


def _required_approvers(db, employee_id, form_levels, next_level):
    """Everyone who must approve `next_level` for this employee's review.

    Levels below the apex route to the single manager at that hop; when the
    chain would hand the level to a top executive, every top executive must
    co-approve it (a multi-approval process at the top)."""
    effective = _effective_levels(db, employee_id, form_levels)
    if next_level < 1 or next_level > effective:
        return []
    approver = _approver_for_level(db, employee_id, next_level)
    if approver is None:
        return []
    if approver in _top_executive_ids(db):
        return _top_executive_ids(db)
    return [approver]


def _prior_levels_approved(db, assignment_id, employee_id, form_levels, next_level):
    """True only when every required approver of every earlier level has
    approved (and none of those levels was rejected). The chain must be
    respected in order regardless of the decider's role."""
    if next_level <= 1:
        return True
    rows = db.execute(
        "SELECT level, approver_id, decision FROM evaluation_approvals "
        "WHERE assignment_id=? AND level < ?",
        (assignment_id, next_level)).fetchall()
    if any(r["decision"] == "rejected" for r in rows):
        return False
    approved_by_level = {}
    for r in rows:
        if r["decision"] == "approved" and r["approver_id"] is not None:
            approved_by_level.setdefault(r["level"], set()).add(r["approver_id"])
    for level in range(1, next_level):
        required = _required_approvers(db, employee_id, form_levels, level)
        approved = approved_by_level.get(level, set())
        if any(aid not in approved for aid in required):
            return False
    return True


def _level_state(db, assignment_id, employee_id, form_levels, next_level):
    """The approver set for `next_level`, which of them already approved, which
    are still pending, and whether the level is complete (all have approved)."""
    required = _required_approvers(db, employee_id, form_levels, next_level)
    approved = set()
    for r in db.execute(
        "SELECT approver_id, decision FROM evaluation_approvals "
        "WHERE assignment_id=? AND level=?",
        (assignment_id, next_level)).fetchall():
        if r["decision"] == "approved" and r["approver_id"] is not None:
            approved.add(r["approver_id"])
    pending = [aid for aid in required if aid not in approved]
    return {"required": required, "approved": sorted(approved), "pending": pending,
            "complete": bool(required) and not pending}


def _notify(db, employee_id, ntype, title, body, entity_type=None, entity_id=None):
    urow = db.execute("SELECT id FROM users WHERE employee_id=?", (employee_id,)).fetchone()
    if not urow:
        return
    db.execute(
        "INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id) "
        "VALUES (?,?,?,?,?,?)",
        (urow["id"], ntype, title, body, entity_type, entity_id))


def _get_form(db, form_id):
    form = db.execute("SELECT * FROM evaluation_forms WHERE id=?", (form_id,)).fetchone()
    return row_to_dict(form)


def _form_detail(db, form_id):
    form = _get_form(db, form_id)
    if not form:
        return None
    sections = rows_to_list(db.execute(
        "SELECT * FROM evaluation_form_sections WHERE form_id=? ORDER BY order_index, id", (form_id,)
    ).fetchall())
    for s in sections:
        s["questions"] = rows_to_list(db.execute(
            "SELECT * FROM evaluation_form_questions WHERE section_id=? ORDER BY order_index, id", (s["id"],)
        ).fetchall())
        for q in s["questions"]:
            q["options"] = json.loads(q["options"]) if q.get("options") else []
    form["sections"] = sections
    return form


def _form_perspective_weights(db, form_id):
    row = db.execute(
        "SELECT weight_self, weight_manager, weight_peer FROM evaluation_forms WHERE id=?", (form_id,)
    ).fetchone()
    if not row:
        return {"self": 1, "manager": 1, "peer": 1}
    return {
        "self": row["weight_self"] or 1,
        "manager": row["weight_manager"] or 1,
        "peer": row["weight_peer"] or 1,
    }


def compute_form_score(db, assignment_id):
    """Deterministic perspective score for one assignment from its answers.

    Each section: (sum of ratings) / (sum of question max scores) * 100.
    The perspective score: section scores weighted by section weight,
    renormalized over sections that actually contain ratings.
    """
    assignment = db.execute("SELECT * FROM evaluation_assignments WHERE id=?", (assignment_id,)).fetchone()
    if not assignment:
        return None
    rows = db.execute(
        "SELECT q.id AS qid, q.max_score, a.rating_value, "
        "       s.id AS sid, s.title, s.weight "
        "FROM evaluation_form_sections s "
        "JOIN evaluation_form_questions q ON q.section_id = s.id "
        "LEFT JOIN evaluation_answers a ON a.question_id = q.id AND a.assignment_id = ? "
        "WHERE s.form_id = ? AND s.perspective = ? ORDER BY s.order_index, q.order_index",
        (assignment_id, assignment["form_id"], assignment["evaluator_type"]),
    ).fetchall()

    sections = {}
    for r in rows:
        sec = sections.setdefault(r["sid"], {"id": r["sid"], "title": r["title"], "weight": r["weight"],
                                             "earned": 0.0, "possible": 0.0})
        if r["rating_value"] is not None and r["max_score"]:
            sec["earned"] += r["rating_value"]
            sec["possible"] += r["max_score"]

    section_scores = []
    for sec in sections.values():
        score = (sec["earned"] / sec["possible"] * 100.0) if sec["possible"] else None
        sections[sec["id"]]["score"] = round(score, 2) if score is not None else None
        section_scores.append({"score": score, "weight": sec["weight"]})

    overall = weighted_average([s for s in section_scores if s["score"] is not None],
                               "score", "weight")
    return {
        "score": round(overall, 2) if overall is not None else None,
        "max_score": 100.0,
        "sections": list(sections.values()),
    }


def compute_overall_score(db, form_id, employee_id, cycle_id):
    """Combined 360 score for a subject: weighted average of every scored
    perspective assignment, renormalized over the ones available."""
    rows = rows_to_list(db.execute(
        "SELECT score, evaluator_type FROM evaluation_assignments "
        "WHERE form_id=? AND employee_id=? AND cycle_id=? AND status='scored' AND score IS NOT NULL",
        (form_id, employee_id, cycle_id)).fetchall())
    if not rows:
        return None
    weights = _form_perspective_weights(db, form_id)
    items = [{"score": r["score"], "weight": weights.get(r["evaluator_type"], 1)} for r in rows]
    overall = weighted_average(items, "score", "weight")
    return round(overall, 2) if overall is not None else None


def refresh_overall(db, form_id, employee_id, cycle_id):
    """Recompute the subject's combined score and store it on every one of
    their assignments for this form/cycle."""
    overall = compute_overall_score(db, form_id, employee_id, cycle_id)
    if overall is not None:
        db.execute(
            "UPDATE evaluation_assignments SET overall_score=? "
            "WHERE form_id=? AND employee_id=? AND cycle_id=?",
            (overall, form_id, employee_id, cycle_id),
        )
    return overall


def _finalize_scored(db, assignment_id, old_status, old_level, reason):
    """Score an assignment and mark it finalized. Used when the last approval
    level completes and when a root (depth-0) employee's review is submitted."""
    row = db.execute(
        "SELECT form_id, employee_id, cycle_id FROM evaluation_assignments WHERE id=?",
        (assignment_id,)).fetchone()
    result = compute_form_score(db, assignment_id)
    score = result["score"] if result else None
    db.execute(
        "UPDATE evaluation_assignments SET status='scored', score=?, max_score=?, "
        "finalized_at=datetime('now') WHERE id=?",
        (score, (result or {}).get("max_score"), assignment_id))
    overall = refresh_overall(db, row["form_id"], row["employee_id"], row["cycle_id"])
    _log(db, "evaluation_assignment", assignment_id, "update",
         old_value={"status": old_status, "current_level": old_level},
         new_value={"status": "scored", "score": score, "overall_score": overall},
         reason=reason)
    return {"score": score, "overall_score": overall,
            "section_scores": result["sections"] if result else []}


def _assignment_detail(db, assignment_id):
    assignment = row_to_dict(db.execute("SELECT * FROM evaluation_assignments WHERE id=?", (assignment_id,)).fetchone())
    if not assignment:
        return None
    form = _form_detail(db, assignment["form_id"])
    employee = row_to_dict(db.execute(
        "SELECT * FROM employees WHERE id=?", (assignment["employee_id"],)).fetchone())
    evaluator = None
    if assignment.get("evaluator_id"):
        evaluator = row_to_dict(db.execute(
            "SELECT * FROM employees WHERE id=?", (assignment["evaluator_id"],)).fetchone())
    cycle = row_to_dict(db.execute(
        "SELECT id, name, status FROM performance_cycles WHERE id=?", (assignment["cycle_id"],)).fetchone())
    answers = rows_to_list(db.execute(
        "SELECT * FROM evaluation_answers WHERE assignment_id=?", (assignment_id,)).fetchall())
    approvals = rows_to_list(db.execute(
        "SELECT ap.*, e.full_name AS approver_name FROM evaluation_approvals ap "
        "LEFT JOIN employees e ON e.id = ap.approver_id WHERE ap.assignment_id=? ORDER BY ap.level",
        (assignment_id,)).fetchall())

    # Only this perspective's sections are visible to the evaluator.
    form["sections"] = [s for s in form["sections"] if s["perspective"] == assignment["evaluator_type"]]

    answers_by_q = {a["question_id"]: a for a in answers}
    for s in form["sections"]:
        for q in s["questions"]:
            q["answer"] = answers_by_q.get(q["id"])

    assignment.update({
        "form": form,
        "employee": employee,
        "evaluator": evaluator,
        "cycle": cycle,
        "approvals": approvals,
    })

    # Approval levels this employee actually needs: the form's cap clamped to
    # their depth in the org hierarchy (leaves more, root fewer).
    form_levels = form["approval_levels"] if form else 0
    effective_levels = _effective_levels(db, assignment["employee_id"], form_levels)
    assignment["approval_levels"] = form_levels
    assignment["effective_levels"] = effective_levels

    # Which level is waiting, and who must act?
    if assignment["status"] in ("submitted", "in_review"):
        next_level = assignment["current_level"] + 1
        level_state = _level_state(db, assignment["id"], assignment["employee_id"],
                                   form_levels, next_level)
        assignment["next_level"] = next_level
        assignment["next_approver_id"] = next_approver_id = level_state["pending"][0] if level_state["pending"] else None
        assignment["required_approvers"] = level_state["required"]
        assignment["approved_approver_ids"] = level_state["approved"]
        assignment["pending_approver_ids"] = level_state["pending"]
        assignment["multi_approval"] = len(level_state["required"]) > 1
        assignment["level_complete"] = level_state["complete"]
        assignment["needs_admin"] = False
        if level_state["required"]:
            names = db.execute(
                f"SELECT id, full_name FROM employees WHERE id IN "
                f"({','.join('?' * len(level_state['required']))})",
                level_state["required"]).fetchall()
            by_id = {r["id"]: r["full_name"] for r in names}
            assignment["required_approver_names"] = [by_id.get(i) for i in level_state["required"]]
            assignment["approved_approver_names"] = [by_id.get(i) for i in level_state["approved"]]
            assignment["pending_approver_names"] = [by_id.get(i) for i in level_state["pending"]]
        else:
            assignment["required_approver_names"] = []
            assignment["approved_approver_names"] = []
            assignment["pending_approver_names"] = []
    return assignment


def _can_view_assignment(db, assignment):
    role = g.user["role"]
    if role in ("admin", "executive"):
        return True
    uid = g.user.get("employee_id")
    if assignment.get("evaluator_id") == uid:
        return True
    if assignment["employee_id"] == uid:
        # The subject may only read the raw form and answers once the
        # assignment is finalized. Until then, aggregated scores are what
        # they see (dashboard / my-evaluations); exposing a manager's or
        # peer's in-flight answers would break review confidentiality.
        return assignment["status"] == "scored"
    if role == "manager":
        next_level = assignment.get("next_level") or assignment.get("current_level", 0) + 1
        form_levels = assignment.get("approval_levels") or 0
        return uid in _required_approvers(db, assignment["employee_id"], form_levels, next_level)
    return False


# ---------------------------------------------------------------------------
# Form template management (admin)
# ---------------------------------------------------------------------------

@bp.get("/evaluation-forms")
@roles_required("admin")
def list_forms():
    db = get_db()
    try:
        rows = rows_to_list(db.execute(
            "SELECT f.*, "
            "(SELECT COUNT(*) FROM evaluation_form_sections s WHERE s.form_id=f.id) AS section_count, "
            "(SELECT COUNT(*) FROM evaluation_form_sections s JOIN evaluation_form_questions q ON q.section_id=s.id "
            " WHERE s.form_id=f.id) AS question_count "
            "FROM evaluation_forms f ORDER BY f.id DESC").fetchall())
        return jsonify(rows)
    finally:
        db.close()


@bp.post("/evaluation-forms")
@roles_required("admin")
def create_form():
    data = request.get_json(force=True) or {}
    if not data.get("name"):
        return jsonify({"error": "name is required"}), 400
    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO evaluation_forms (name, description, approval_levels, active, "
            "weight_self, weight_manager, weight_peer) VALUES (?,?,?,?,?,?,?)",
            (data["name"], data.get("description"), int(data.get("approval_levels", 2)),
             int(bool(data.get("active", True))),
             float(data.get("weight_self", 1)), float(data.get("weight_manager", 1)),
             float(data.get("weight_peer", 1))),
        )
        _log(db, "evaluation_form", cur.lastrowid, "create", new_value=data)
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201
    finally:
        db.close()


@bp.get("/evaluation-forms/<int:form_id>")
@roles_required("admin")
def get_form(form_id):
    db = get_db()
    try:
        detail = _form_detail(db, form_id)
        if not detail:
            return jsonify({"error": "Not found"}), 404
        return jsonify(detail)
    finally:
        db.close()


@bp.put("/evaluation-forms/<int:form_id>")
@roles_required("admin")
def update_form(form_id):
    data = request.get_json(force=True) or {}
    db = get_db()
    try:
        row = db.execute("SELECT * FROM evaluation_forms WHERE id=?", (form_id,)).fetchone()
        if not row:
            return jsonify({"error": "Not found"}), 404
        fields = {k: data[k] for k in
                  ("name", "description", "approval_levels", "active", "weight_self", "weight_manager", "weight_peer")
                  if k in data}
        if fields:
            db.execute(
                f"UPDATE evaluation_forms SET {', '.join(f'{k}=?' for k in fields)} WHERE id=?",
                (*fields.values(), form_id),
            )
            _log(db, "evaluation_form", form_id, "update", old_value=row_to_dict(row), new_value=fields)
            db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


@bp.delete("/evaluation-forms/<int:form_id>")
@roles_required("admin")
def delete_form(form_id):
    """Admin hard-deletes a form template. Assignments (and their answers,
    approvals, acknowledgements and notifications) are cascaded away."""
    db = get_db()
    try:
        form = db.execute("SELECT * FROM evaluation_forms WHERE id=?", (form_id,)).fetchone()
        if not form:
            return jsonify({"error": "Not found"}), 404
        assignment_ids = [r["id"] for r in db.execute(
            "SELECT id FROM evaluation_assignments WHERE form_id=?", (form_id,)).fetchall()]
        if assignment_ids:
            ph = ",".join("?" * len(assignment_ids))
            db.execute(
                f"DELETE FROM notifications WHERE entity_type='evaluation' AND entity_id IN ({ph})",
                assignment_ids)
            db.execute(
                f"DELETE FROM evaluation_assignments WHERE id IN ({ph})",
                assignment_ids)
        db.execute("DELETE FROM evaluation_forms WHERE id=?", (form_id,))
        _log(db, "evaluation_form", form_id, "delete",
             old_value={"name": form["name"], "approval_levels": form["approval_levels"]},
             new_value={"assignments_deleted": len(assignment_ids)},
             reason=f"admin deleted form template '{form['name']}'")
        db.commit()
        return jsonify({"ok": True, "assignments_deleted": len(assignment_ids)})
    finally:
        db.close()


@bp.post("/evaluation-forms/<int:form_id>/sections")
@roles_required("admin")
def add_section(form_id):
    data = request.get_json(force=True) or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "title is required"}), 400
    perspective = data.get("perspective", "self")
    if perspective not in PERSPECTIVES:
        return jsonify({"error": f"perspective must be one of {PERSPECTIVES}"}), 400
    db = get_db()
    try:
        if not _get_form(db, form_id):
            return jsonify({"error": "Not found"}), 404
        order = db.execute(
            "SELECT COALESCE(MAX(order_index), -1) + 1 o FROM evaluation_form_sections WHERE form_id=?",
            (form_id,)).fetchone()["o"]
        cur = db.execute(
            "INSERT INTO evaluation_form_sections (form_id, title, description, weight, perspective, order_index) "
            "VALUES (?,?,?,?,?,?)",
            (form_id, title, data.get("description"), float(data.get("weight", 1)), perspective, order),
        )
        _log(db, "evaluation_form_section", cur.lastrowid, "create", new_value=data)
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201
    finally:
        db.close()


@bp.put("/evaluation-form-sections/<int:section_id>")
@roles_required("admin")
def update_section(section_id):
    data = request.get_json(force=True) or {}
    db = get_db()
    try:
        row = db.execute("SELECT * FROM evaluation_form_sections WHERE id=?", (section_id,)).fetchone()
        if not row:
            return jsonify({"error": "Not found"}), 404
        if "title" in data and not (data.get("title") or "").strip():
            return jsonify({"error": "title cannot be empty"}), 400
        if "perspective" in data and data["perspective"] not in PERSPECTIVES:
            return jsonify({"error": f"perspective must be one of {PERSPECTIVES}"}), 400
        fields = {k: data[k] for k in ("title", "description", "weight", "perspective") if k in data}
        if fields:
            db.execute(
                f"UPDATE evaluation_form_sections SET {', '.join(f'{k}=?' for k in fields)} WHERE id=?",
                (*fields.values(), section_id),
            )
            _log(db, "evaluation_form_section", section_id, "update", old_value=row_to_dict(row), new_value=fields)
            db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


@bp.delete("/evaluation-form-sections/<int:section_id>")
@roles_required("admin")
def delete_section(section_id):
    db = get_db()
    try:
        row = db.execute("SELECT * FROM evaluation_form_sections WHERE id=?", (section_id,)).fetchone()
        if not row:
            return jsonify({"error": "Not found"}), 404
        db.execute("DELETE FROM evaluation_form_sections WHERE id=?", (section_id,))
        _log(db, "evaluation_form_section", section_id, "delete", old_value=row_to_dict(row))
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


@bp.post("/evaluation-form-sections/<int:section_id>/move")
@roles_required("admin")
def move_section(section_id):
    data = request.get_json(force=True) or {}
    direction = data.get("direction")
    if direction not in ("up", "down"):
        return jsonify({"error": "direction must be 'up' or 'down'"}), 400
    db = get_db()
    try:
        row = db.execute("SELECT * FROM evaluation_form_sections WHERE id=?", (section_id,)).fetchone()
        if not row:
            return jsonify({"error": "Not found"}), 404
        siblings = rows_to_list(db.execute(
            "SELECT id, order_index FROM evaluation_form_sections WHERE form_id=? ORDER BY order_index, id",
            (row["form_id"],)).fetchall())
        idx = next((i for i, s in enumerate(siblings) if s["id"] == section_id), None)
        if idx is None:
            return jsonify({"error": "Not found"}), 404
        swap = idx - 1 if direction == "up" else idx + 1
        if swap < 0 or swap >= len(siblings):
            return jsonify({"ok": True, "moved": False})
        a, b = siblings[idx], siblings[swap]
        db.execute("UPDATE evaluation_form_sections SET order_index=? WHERE id=?", (b["order_index"], a["id"]))
        db.execute("UPDATE evaluation_form_sections SET order_index=? WHERE id=?", (a["order_index"], b["id"]))
        db.commit()
        return jsonify({"ok": True, "moved": True})
    finally:
        db.close()


@bp.post("/evaluation-form-sections/<int:section_id>/duplicate")
@roles_required("admin")
def duplicate_section(section_id):
    db = get_db()
    try:
        src = db.execute("SELECT * FROM evaluation_form_sections WHERE id=?", (section_id,)).fetchone()
        if not src:
            return jsonify({"error": "Not found"}), 404
        order = db.execute(
            "SELECT COALESCE(MAX(order_index), -1) + 1 o FROM evaluation_form_sections WHERE form_id=?",
            (src["form_id"],)).fetchone()["o"]
        cur = db.execute(
            "INSERT INTO evaluation_form_sections (form_id, title, description, weight, perspective, order_index) "
            "VALUES (?,?,?,?,?,?)",
            (src["form_id"], src["title"] + " (copy)", src["description"], src["weight"],
             src["perspective"], order))
        new_id = cur.lastrowid
        for q in db.execute(
            "SELECT * FROM evaluation_form_questions WHERE section_id=? ORDER BY order_index, id",
            (section_id,)).fetchall():
            db.execute(
                "INSERT INTO evaluation_form_questions (section_id, text, description, kind, max_score, options, "
                "required, order_index) VALUES (?,?,?,?,?,?,?,?)",
                (new_id, q["text"], q["description"], q["kind"], q["max_score"], q["options"],
                 q["required"], q["order_index"]))
        _log(db, "evaluation_form_section", new_id, "create",
             new_value={"source": section_id, "title": src["title"]}, reason="section duplicated")
        db.commit()
        return jsonify({"id": new_id}), 201
    finally:
        db.close()


@bp.post("/evaluation-form-sections/<int:section_id>/questions")
@roles_required("admin")
def add_question(section_id):
    data = request.get_json(force=True) or {}
    if not (data.get("text") or "").strip():
        return jsonify({"error": "text is required"}), 400
    kind = data.get("kind", "rating")
    if kind not in ALLOWED_KINDS:
        return jsonify({"error": f"kind must be one of {ALLOWED_KINDS}"}), 400
    db = get_db()
    try:
        row = db.execute("SELECT * FROM evaluation_form_sections WHERE id=?", (section_id,)).fetchone()
        if not row:
            return jsonify({"error": "Not found"}), 404
        max_score, options_json = None, None
        if kind in ("rating", "scale"):
            max_score = float(data.get("max_score") or (5 if kind == "rating" else 100))
        elif kind in ("select", "multi"):
            options = data.get("options") or DEFAULT_OPTIONS
            if not isinstance(options, list) or not options:
                options = DEFAULT_OPTIONS
            options_json = json.dumps(options)
        order = db.execute(
            "SELECT COALESCE(MAX(order_index), -1) + 1 o FROM evaluation_form_questions WHERE section_id=?",
            (section_id,)).fetchone()["o"]
        cur = db.execute(
            "INSERT INTO evaluation_form_questions (section_id, text, description, kind, max_score, options, "
            "required, order_index) VALUES (?,?,?,?,?,?,?,?)",
            (section_id, (data.get("text") or "").strip(), data.get("description"), kind, max_score, options_json,
             int(bool(data.get("required"))), order),
        )
        _log(db, "evaluation_form_question", cur.lastrowid, "create", new_value=data)
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201
    finally:
        db.close()


@bp.put("/evaluation-form-questions/<int:question_id>")
@roles_required("admin")
def update_question(question_id):
    data = request.get_json(force=True) or {}
    db = get_db()
    try:
        row = db.execute("SELECT * FROM evaluation_form_questions WHERE id=?", (question_id,)).fetchone()
        if not row:
            return jsonify({"error": "Not found"}), 404
        if "kind" in data and data["kind"] not in ALLOWED_KINDS:
            return jsonify({"error": f"kind must be one of {ALLOWED_KINDS}"}), 400
        if "text" in data and not (data.get("text") or "").strip():
            return jsonify({"error": "text cannot be empty"}), 400

        fields = {}
        for k in ("text", "description", "required"):
            if k in data:
                fields[k] = data[k]
        if "kind" in data:
            fields["kind"] = data["kind"]
            if data["kind"] in ("text", "select", "multi"):
                fields["max_score"] = None
            elif "max_score" not in data:
                fields["max_score"] = row["max_score"] or 5
        if "max_score" in data and fields.get("kind", row["kind"]) in ("rating", "scale"):
            fields["max_score"] = float(data["max_score"])
        if "options" in data and fields.get("kind", row["kind"]) in ("select", "multi"):
            opts = data["options"]
            if not isinstance(opts, list) or not opts:
                opts = DEFAULT_OPTIONS
            fields["options"] = json.dumps(opts)

        if fields:
            db.execute(
                f"UPDATE evaluation_form_questions SET {', '.join(f'{k}=?' for k in fields)} WHERE id=?",
                (*fields.values(), question_id),
            )
            _log(db, "evaluation_form_question", question_id, "update", old_value=row_to_dict(row), new_value=fields)
            db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


@bp.delete("/evaluation-form-questions/<int:question_id>")
@roles_required("admin")
def delete_question(question_id):
    db = get_db()
    try:
        row = db.execute("SELECT * FROM evaluation_form_questions WHERE id=?", (question_id,)).fetchone()
        if not row:
            return jsonify({"error": "Not found"}), 404
        db.execute("DELETE FROM evaluation_form_questions WHERE id=?", (question_id,))
        _log(db, "evaluation_form_question", question_id, "delete", old_value=row_to_dict(row))
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


@bp.post("/evaluation-form-questions/<int:question_id>/move")
@roles_required("admin")
def move_question(question_id):
    data = request.get_json(force=True) or {}
    direction = data.get("direction")
    if direction not in ("up", "down"):
        return jsonify({"error": "direction must be 'up' or 'down'"}), 400
    db = get_db()
    try:
        row = db.execute("SELECT * FROM evaluation_form_questions WHERE id=?", (question_id,)).fetchone()
        if not row:
            return jsonify({"error": "Not found"}), 404
        siblings = rows_to_list(db.execute(
            "SELECT id, order_index FROM evaluation_form_questions WHERE section_id=? ORDER BY order_index, id",
            (row["section_id"],)).fetchall())
        idx = next((i for i, s in enumerate(siblings) if s["id"] == question_id), None)
        if idx is None:
            return jsonify({"error": "Not found"}), 404
        swap = idx - 1 if direction == "up" else idx + 1
        if swap < 0 or swap >= len(siblings):
            return jsonify({"ok": True, "moved": False})
        a, b = siblings[idx], siblings[swap]
        db.execute("UPDATE evaluation_form_questions SET order_index=? WHERE id=?", (b["order_index"], a["id"]))
        db.execute("UPDATE evaluation_form_questions SET order_index=? WHERE id=?", (a["order_index"], b["id"]))
        db.commit()
        return jsonify({"ok": True, "moved": True})
    finally:
        db.close()


@bp.post("/evaluation-form-questions/<int:question_id>/duplicate")
@roles_required("admin")
def duplicate_question(question_id):
    db = get_db()
    try:
        src = db.execute("SELECT * FROM evaluation_form_questions WHERE id=?", (question_id,)).fetchone()
        if not src:
            return jsonify({"error": "Not found"}), 404
        db.execute(
            "UPDATE evaluation_form_questions SET order_index=order_index+1 "
            "WHERE section_id=? AND order_index>?",
            (src["section_id"], src["order_index"]))
        cur = db.execute(
            "INSERT INTO evaluation_form_questions (section_id, text, description, kind, max_score, options, "
            "required, order_index) VALUES (?,?,?,?,?,?,?,?)",
            (src["section_id"], src["text"], src["description"], src["kind"], src["max_score"],
             src["options"], src["required"], src["order_index"] + 1))
        _log(db, "evaluation_form_question", cur.lastrowid, "create",
             new_value={"source": question_id, "text": src["text"]}, reason="question duplicated")
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201
    finally:
        db.close()


def _create_assignment(db, form_id, employee_id, cycle_id, evaluator_type, evaluator_id, due_date=None):
    existing = db.execute(
        "SELECT id FROM evaluation_assignments WHERE form_id=? AND employee_id=? AND cycle_id=? "
        "AND evaluator_type=? AND evaluator_id=?",
        (form_id, employee_id, cycle_id, evaluator_type, evaluator_id)).fetchone()
    if existing:
        return existing["id"]
    cur = db.execute(
        "INSERT INTO evaluation_assignments (form_id, employee_id, cycle_id, evaluator_type, evaluator_id, due_date) "
        "VALUES (?,?,?,?,?,?)",
        (form_id, employee_id, cycle_id, evaluator_type, evaluator_id, due_date or None))
    return cur.lastrowid


@bp.post("/evaluation-forms/<int:form_id>/assign")
@roles_required("admin")
def assign_form(form_id):
    data = request.get_json(force=True) or {}
    cycle_id = data.get("cycle_id")
    if not cycle_id:
        return jsonify({"error": "cycle_id is required"}), 400
    due_date = (data.get("due_date") or "").strip() or None
    spec = data.get("assignments")
    if spec is None:
        employee_ids = data.get("employee_ids") or []
        spec = [{"employee_id": e, "with_manager": False, "peer_ids": []} for e in employee_ids]
    if not spec:
        return jsonify({"error": "assignments is required"}), 400

    db = get_db()
    try:
        form = _get_form(db, form_id)
        if not form:
            return jsonify({"error": "Form not found"}), 404
        form_perspectives = set(r["perspective"] for r in db.execute(
            "SELECT DISTINCT perspective FROM evaluation_form_sections WHERE form_id=?", (form_id,)))
        created = []
        skipped = 0
        for entry in spec:
            emp_id = entry.get("employee_id")
            if not emp_id:
                continue
            aid = _create_assignment(db, form_id, emp_id, cycle_id, "self", emp_id, due_date)
            if aid not in created:
                created.append(aid)
            else:
                skipped += 1
            if entry.get("with_manager") and "manager" in form_perspectives:
                mgr = db.execute("SELECT manager_id FROM employees WHERE id=?", (emp_id,)).fetchone()
                if mgr and mgr["manager_id"]:
                    aid = _create_assignment(db, form_id, emp_id, cycle_id, "manager",
                                             mgr["manager_id"], due_date)
                    if aid not in created:
                        created.append(aid)
            if "peer" in form_perspectives:
                for pid in entry.get("peer_ids") or []:
                    if not pid or pid == emp_id:
                        continue
                    aid = _create_assignment(db, form_id, emp_id, cycle_id, "peer", pid, due_date)
                    if aid not in created:
                        created.append(aid)
        if created:
            _log(db, "evaluation_assignment", form_id, "create",
                 new_value={"form_id": form_id, "cycle_id": cycle_id, "due_date": due_date,
                            "assignments": created},
                 reason="form assigned to employees (360)")
        db.commit()
        return jsonify({"created": created, "skipped": skipped})
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Evaluators: my evaluations (as subject or as reviewer)
# ---------------------------------------------------------------------------

@bp.get("/me/evaluations")
@login_required
def my_evaluations():
    db = get_db()
    try:
        uid = g.user.get("employee_id")
        rows = rows_to_list(db.execute(
            "SELECT a.*, f.name AS form_name, f.approval_levels, "
            "c.name AS cycle_name, c.status AS cycle_status, "
            "e.full_name AS subject_name, e.position AS subject_position, "
            "ev.full_name AS evaluator_name "
            "FROM evaluation_assignments a "
            "JOIN evaluation_forms f ON f.id = a.form_id "
            "JOIN employees e ON e.id = a.employee_id "
            "LEFT JOIN employees ev ON ev.id = a.evaluator_id "
            "JOIN performance_cycles c ON c.id = a.cycle_id "
            "WHERE a.employee_id = ? OR a.evaluator_id = ? "
            "ORDER BY c.start_date DESC, a.id DESC",
            (uid, uid)).fetchall())
        return jsonify(rows)
    finally:
        db.close()


@bp.get("/evaluations/<int:assignment_id>")
@login_required
def get_assignment(assignment_id):
    db = get_db()
    try:
        detail = _assignment_detail(db, assignment_id)
        if not detail:
            return jsonify({"error": "Not found"}), 404
        if not _can_view_assignment(db, detail):
            return jsonify({"error": "Forbidden"}), 403
        return jsonify(detail)
    finally:
        db.close()


@bp.post("/evaluations/<int:assignment_id>/answers")
@login_required
def save_or_submit(assignment_id):
    data = request.get_json(force=True) or {}
    action = data.get("action", "save")  # save | submit
    db = get_db()
    try:
        detail = _assignment_detail(db, assignment_id)
        if not detail:
            return jsonify({"error": "Not found"}), 404
        evaluator_id = detail["evaluator_id"] or detail["employee_id"]
        if evaluator_id != g.user.get("employee_id"):
            return jsonify({"error": "Forbidden: only the designated evaluator can fill this evaluation"}), 403
        if detail["status"] not in ("draft", "rejected"):
            return jsonify({"error": f"Cannot edit an evaluation in status '{detail['status']}'"}), 409

        # Track the current answers so required-question validation below sees
        # both pre-existing answers and the ones upserted in this request.
        answers_map = {}
        for s in detail["form"]["sections"]:
            for q in s["questions"]:
                if q.get("answer"):
                    answers_map[q["id"]] = q["answer"]

        # Question metadata for server-side bounds validation (the client
        # restricts inputs, but a direct API call must not be able to submit a
        # rating above the question's max score and skew the computed result).
        qmeta = {q["id"]: q for s in detail["form"]["sections"] for q in s["questions"]}

        for answer in data.get("answers", []):
            qid = answer.get("question_id")
            if not qid:
                continue
            q = qmeta.get(qid)
            rating = answer.get("rating_value")
            if q and rating is not None and q["kind"] in ("rating", "scale") and q.get("max_score"):
                try:
                    rating_num = float(rating)
                except (TypeError, ValueError):
                    return jsonify({"error": f"Rating for \"{q['text']}\" must be a number"}), 400
                if not (0 <= rating_num <= float(q["max_score"])):
                    return jsonify({
                        "error": f"Rating for \"{q['text']}\" must be between 0 and {q['max_score']}",
                    }), 400
            db.execute(
                "INSERT INTO evaluation_answers (assignment_id, question_id, rating_value, text_value, note) "
                "VALUES (?,?,?,?,?) "
                "ON CONFLICT(assignment_id, question_id) "
                "DO UPDATE SET rating_value=excluded.rating_value, text_value=excluded.text_value, "
                "note=excluded.note",
                (assignment_id, qid, answer.get("rating_value"), answer.get("text_value"),
                 (answer.get("note") or "").strip() or None),
            )
            answers_map[qid] = answer

        if action == "submit":
            # Required questions within this perspective must be answered.
            missing = []
            for s in detail["form"]["sections"]:
                for q in s["questions"]:
                    if not q.get("required"):
                        continue
                    ans = answers_map.get(q["id"])
                    has_rating = ans is not None and ans.get("rating_value") is not None
                    has_text = ans is not None and (ans.get("text_value") or "").strip()
                    if not has_rating and not has_text:
                        missing.append(q["text"])
            if missing:
                return jsonify({"error": "Required questions are unanswered: " + "; ".join(missing[:3])}), 400

            db.execute(
                "DELETE FROM evaluation_approvals WHERE assignment_id=?",
                (assignment_id,))
            db.execute(
                "UPDATE evaluation_assignments SET status='submitted', current_level=0, "
                "submitted_at=datetime('now') WHERE id=?",
                (assignment_id,))
            # Root employees (no manager above them) need no approvals: the
            # submission is scored immediately.
            if detail["effective_levels"] == 0:
                finalized = _finalize_scored(
                    db, assignment_id, detail["status"], detail["current_level"],
                    "submitted by a root employee with no approval chain; score computed from form answers")
                _notify(db, detail["employee_id"], "evaluation_scored",
                        "Your evaluation has been scored",
                        f"Your '{detail['form']['name']}' submission was finalized without approvals.",
                        "evaluation", assignment_id)
                db.commit()
                return jsonify({"ok": True, "status": "scored", **finalized})
            _log(db, "evaluation_assignment", assignment_id, "update",
                 old_value={"status": detail["status"]}, new_value={"status": "submitted"},
                 reason="evaluator submitted evaluation form")
            db.commit()
            return jsonify({"ok": True, "status": "submitted"})

        _log(db, "evaluation_assignment", assignment_id, "update",
             new_value={"answers": len(data.get("answers", [])), "status": detail["status"]},
             reason="draft answers saved")
        db.commit()
        return jsonify({"ok": True, "status": detail["status"]})
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Approvers: queue + decision
# ---------------------------------------------------------------------------

@bp.get("/approvals/pending")
@login_required
def pending_approvals():
    db = get_db()
    try:
        rows = rows_to_list(db.execute(
            "SELECT a.*, f.name AS form_name, f.approval_levels, "
            "e.full_name AS subject_name, e.position AS subject_position, "
            "ev.full_name AS evaluator_name, ev.position AS evaluator_position, "
            "c.name AS cycle_name "
            "FROM evaluation_assignments a "
            "JOIN evaluation_forms f ON f.id = a.form_id "
            "JOIN employees e ON e.id = a.employee_id "
            "LEFT JOIN employees ev ON ev.id = a.evaluator_id "
            "JOIN performance_cycles c ON c.id = a.cycle_id "
            "WHERE a.status IN ('submitted','in_review') ORDER BY a.submitted_at").fetchall())
        uid = g.user.get("employee_id")
        pending = []
        for r in rows:
            next_level = r["current_level"] + 1
            if not _prior_levels_approved(db, r["id"], r["employee_id"], r["approval_levels"], next_level):
                continue
            level_state = _level_state(db, r["id"], r["employee_id"], r["approval_levels"], next_level)
            if uid not in level_state["pending"]:
                continue
            r["next_level"] = next_level
            r["next_approver_id"] = uid
            r["required_approvers"] = level_state["required"]
            r["approved_approver_ids"] = level_state["approved"]
            r["pending_approver_ids"] = level_state["pending"]
            r["multi_approval"] = len(level_state["required"]) > 1
            r["effective_levels"] = _effective_levels(db, r["employee_id"], r["approval_levels"])
            r["needs_admin"] = False
            pending.append(r)
        return jsonify(pending)
    finally:
        db.close()


@bp.get("/approvals/waiting")
@roles_required("admin", "executive")
def waiting_approvals():
    """Read-only view of submissions blocked on earlier approval levels.

    Admin/executive cannot act on these yet; next_approver_name shows who must
    approve before the chain can advance."""
    db = get_db()
    try:
        rows = rows_to_list(db.execute(
            "SELECT a.*, f.name AS form_name, f.approval_levels, "
            "e.full_name AS subject_name, e.position AS subject_position, "
            "c.name AS cycle_name "
            "FROM evaluation_assignments a "
            "JOIN evaluation_forms f ON f.id = a.form_id "
            "JOIN employees e ON e.id = a.employee_id "
            "JOIN performance_cycles c ON c.id = a.cycle_id "
            "WHERE a.status IN ('submitted','in_review') ORDER BY a.submitted_at").fetchall())
        uid = g.user.get("employee_id")
        waiting = []
        for r in rows:
            next_level = r["current_level"] + 1
            level_state = _level_state(db, r["id"], r["employee_id"], r["approval_levels"], next_level)
            # Actionable by this admin/executive? Then it belongs in pending.
            if _prior_levels_approved(db, r["id"], r["employee_id"], r["approval_levels"], next_level) \
                    and uid in level_state["pending"]:
                continue
            r["next_level"] = next_level
            r["next_approver_id"] = level_state["pending"][0] if level_state["pending"] else None
            r["required_approvers"] = level_state["required"]
            r["approved_approver_ids"] = level_state["approved"]
            r["pending_approver_ids"] = level_state["pending"]
            r["multi_approval"] = len(level_state["required"]) > 1
            r["effective_levels"] = _effective_levels(db, r["employee_id"], r["approval_levels"])
            r["needs_admin"] = False
            if level_state["required"]:
                names = db.execute(
                    f"SELECT id, full_name FROM employees WHERE id IN "
                    f"({','.join('?' * len(level_state['required']))})",
                    level_state["required"]).fetchall()
                by_id = {n["id"]: n["full_name"] for n in names}
                r["required_approver_names"] = [by_id.get(i) for i in level_state["required"]]
            else:
                r["required_approver_names"] = []
            waiting.append(r)
        return jsonify(waiting)
    finally:
        db.close()


@bp.post("/evaluations/<int:assignment_id>/decision")
@login_required
def decide_assignment(assignment_id):
    data = request.get_json(force=True) or {}
    decision = data.get("decision")
    comments = (data.get("comments") or "").strip()
    if decision not in ("approve", "reject"):
        return jsonify({"error": "decision must be 'approve' or 'reject'"}), 400
    if not comments:
        return jsonify({"error": "comments are required for every decision"}), 400

    db = get_db()
    try:
        detail = _assignment_detail(db, assignment_id)
        if not detail:
            return jsonify({"error": "Not found"}), 404
        if detail["status"] not in ("submitted", "in_review"):
            return jsonify({"error": f"Cannot decide an evaluation in status '{detail['status']}'"}), 409

        next_level = detail["current_level"] + 1
        uid = g.user.get("employee_id")
        form_levels = detail["approval_levels"]
        effective_levels = detail["effective_levels"]
        if next_level > effective_levels:
            return jsonify({"error": "This evaluation needs no more approvals; it is already complete"}), 409
        level_state = _level_state(db, assignment_id, detail["employee_id"], form_levels, next_level)
        if uid not in level_state["pending"]:
            names = ", ".join(detail.get("required_approver_names") or [])
            return jsonify(
                {"error": f"Forbidden: level {next_level} must be approved by: {names or 'no one in the chain'}"}), 403
        if not _prior_levels_approved(db, assignment_id, detail["employee_id"], form_levels, next_level):
            return jsonify(
                {"error": "Prior approval levels must be approved before this level can be decided"}), 409

        db.execute(
            "INSERT INTO evaluation_approvals (assignment_id, level, approver_id, decision, comments) "
            "VALUES (?,?,?,?,?)",
            (assignment_id, next_level, uid,
             "approved" if decision == "approve" else "rejected", comments))

        if decision == "reject":
            db.execute(
                "UPDATE evaluation_assignments SET status='rejected' WHERE id=?", (assignment_id,))
            _log(db, "evaluation_assignment", assignment_id, "update",
                 old_value={"status": detail["status"]}, new_value={"status": "rejected"},
                 reason=f"rejected at level {next_level}")
            _notify(db, detail["employee_id"], "evaluation_rejected",
                    "Evaluation returned",
                    f"Your evaluation was rejected at level {next_level}. Please review and resubmit.",
                    "evaluation", assignment_id)
            db.commit()
            return jsonify({"ok": True, "status": "rejected"})

        # The level is complete only once every required approver has approved;
        # at the apex that is a multi-approval process across all top executives.
        level_state = _level_state(db, assignment_id, detail["employee_id"], form_levels, next_level)
        if not level_state["complete"]:
            db.execute("UPDATE evaluation_assignments SET status='in_review' WHERE id=?", (assignment_id,))
            _log(db, "evaluation_assignment", assignment_id, "update",
                 old_value={"status": detail["status"], "current_level": detail["current_level"]},
                 new_value={"status": "in_review", "level": next_level,
                            "approved": level_state["approved"], "pending": level_state["pending"]},
                 reason=f"approved at level {next_level}; waiting on the remaining approvers")
            db.commit()
            return jsonify({"ok": True, "status": "in_review", "current_level": detail["current_level"]})

        db.execute(
            "UPDATE evaluation_assignments SET current_level=? WHERE id=?",
            (next_level, assignment_id))
        has_next = next_level < effective_levels
        if has_next:
            db.execute("UPDATE evaluation_assignments SET status='in_review' WHERE id=?", (assignment_id,))
            _log(db, "evaluation_assignment", assignment_id, "update",
                 old_value={"status": detail["status"], "current_level": detail["current_level"]},
                 new_value={"status": "in_review", "current_level": next_level},
                 reason=f"level {next_level} fully approved")
            nxt_state = _level_state(db, assignment_id, detail["employee_id"], form_levels, next_level + 1)
            for aid in nxt_state["required"]:
                _notify(db, aid, "approval_pending",
                        "Approval required",
                        f"{detail['employee']['full_name']}'s evaluation is awaiting your approval "
                        f"at level {next_level + 1}.",
                        "evaluation", assignment_id)
            db.commit()
            return jsonify({"ok": True, "status": "in_review", "current_level": next_level})

        # Final level fully approved -> compute this perspective's score + the
        # subject's 360 overall.
        finalized = _finalize_scored(
            db, assignment_id, detail["status"], detail["current_level"],
            f"final level {next_level} approved; score computed from form answers")
        db.commit()
        return jsonify({"ok": True, "status": "scored", **finalized})
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Admin: assignment CRUD (list / edit / delete)
# ---------------------------------------------------------------------------

@bp.get("/evaluation-assignments")
@roles_required("admin", "executive")
def all_assignments():
    status = request.args.get("status")
    db = get_db()
    try:
        sql = ("SELECT a.*, f.name AS form_name, f.approval_levels, "
               "e.full_name AS subject_name, e.position AS subject_position, "
               "ev.full_name AS evaluator_name, "
               "d.name AS department_name, c.name AS cycle_name "
               "FROM evaluation_assignments a "
               "JOIN evaluation_forms f ON f.id = a.form_id "
               "JOIN employees e ON e.id = a.employee_id "
               "LEFT JOIN employees ev ON ev.id = a.evaluator_id "
               "LEFT JOIN departments d ON d.id = e.department_id "
               "JOIN performance_cycles c ON c.id = a.cycle_id")
        params = []
        if status and status != "all":
            sql += " WHERE a.status=?"
            params.append(status)
        sql += " ORDER BY a.id DESC"
        rows = rows_to_list(db.execute(sql, params).fetchall())
        return jsonify(rows)
    finally:
        db.close()


@bp.put("/evaluation-assignments/<int:assignment_id>")
@roles_required("admin")
def update_assignment(assignment_id):
    """Admin edits assignment metadata (due date, cycle, evaluator) at any
    time. A separate `reopen` action resets an in-flight or finalized record
    back to draft, clearing approvals and scores while keeping answers."""
    data = request.get_json(force=True) or {}
    db = get_db()
    try:
        detail = _assignment_detail(db, assignment_id)
        if not detail:
            return jsonify({"error": "Not found"}), 404

        if data.get("action") == "reopen":
            if detail["status"] == "draft":
                return jsonify({"error": "Evaluation is already a draft"}), 409
            db.execute(
                "DELETE FROM evaluation_approvals WHERE assignment_id=?",
                (assignment_id,))
            db.execute(
                "UPDATE evaluation_assignments SET status='draft', current_level=0, "
                "score=NULL, max_score=NULL, submitted_at=NULL, finalized_at=NULL WHERE id=?",
                (assignment_id,))
            if detail.get("overall_score") is not None:
                refresh_overall(db, detail["form_id"], detail["employee_id"], detail["cycle_id"])
            _log(db, "evaluation_assignment", assignment_id, "update",
                 old_value={"status": detail["status"], "current_level": detail["current_level"]},
                 new_value={"status": "draft", "current_level": 0},
                 reason=f"admin reopened evaluation from {detail['status']}")
            db.commit()
            return jsonify({"ok": True, "status": "draft"})

        old = {}
        new = {}
        if "due_date" in data:
            old["due_date"] = detail["due_date"]
            new["due_date"] = (data.get("due_date") or "").strip() or None
        if "cycle_id" in data:
            cycle = db.execute("SELECT id FROM performance_cycles WHERE id=?",
                               (data.get("cycle_id"),)).fetchone()
            if not cycle:
                return jsonify({"error": "Unknown cycle_id"}), 400
            old["cycle_id"] = detail["cycle_id"]
            new["cycle_id"] = data["cycle_id"]
        if "evaluator_id" in data or "evaluator_type" in data:
            evaluator_type = data.get("evaluator_type", detail["evaluator_type"])
            evaluator_id = data.get("evaluator_id", detail["evaluator_id"])
            if evaluator_type not in PERSPECTIVES:
                return jsonify({"error": "evaluator_type must be one of self, manager, peer"}), 400
            has_perspective = db.execute(
                "SELECT 1 FROM evaluation_form_sections WHERE form_id=? AND perspective=? LIMIT 1",
                (detail["form_id"], evaluator_type)).fetchone()
            if not has_perspective:
                return jsonify({"error": f"Form has no '{evaluator_type}' perspective"}), 400
            if evaluator_type == "self":
                evaluator_id = detail["employee_id"]
            elif evaluator_id:
                emp = db.execute("SELECT id FROM employees WHERE id=?", (evaluator_id,)).fetchone()
                if not emp:
                    return jsonify({"error": "Unknown evaluator_id"}), 400
            else:
                return jsonify({"error": "evaluator_id is required for this perspective"}), 400
            old["evaluator_type"] = detail["evaluator_type"]
            old["evaluator_id"] = detail["evaluator_id"]
            new["evaluator_type"] = evaluator_type
            new["evaluator_id"] = evaluator_id
        if not new:
            return jsonify({"error": "Nothing to update"}), 400

        new_status = detail["status"]
        if new.get("cycle_id") != detail["cycle_id"] or new.get("evaluator_type") != detail["evaluator_type"] \
                or new.get("evaluator_id") != detail["evaluator_id"]:
            # A change of cycle/perspective/evaluator invalidates workflow state.
            if detail["status"] != "draft":
                db.execute(
                    "UPDATE evaluation_assignments SET status='draft', current_level=0, "
                    "score=NULL, max_score=NULL, submitted_at=NULL, finalized_at=NULL WHERE id=?",
                    (assignment_id,))
                db.execute("DELETE FROM evaluation_approvals WHERE assignment_id=?", (assignment_id,))
                new_status = "draft"

        sets = []
        params = []
        for col in ("due_date", "cycle_id", "evaluator_type", "evaluator_id"):
            if col in new:
                sets.append(f"{col}=?")
                params.append(new[col])
        if sets:
            params.append(assignment_id)
            db.execute(f"UPDATE evaluation_assignments SET {', '.join(sets)} WHERE id=?", params)

        if new.get("cycle_id") and new.get("cycle_id") != detail["cycle_id"]:
            refresh_overall(db, detail["form_id"], detail["employee_id"], detail["cycle_id"])
            refresh_overall(db, detail["form_id"], detail["employee_id"], new["cycle_id"])
        if new.get("evaluator_id") and new.get("evaluator_id") != detail.get("evaluator_id"):
            _notify(db, new["evaluator_id"], "evaluation_assigned",
                    "Evaluation assigned to you",
                    f"You have been assigned to complete {detail['employee']['full_name']}'s "
                    f"'{detail['form']['name']}' review.",
                    "evaluation", assignment_id)
        _log(db, "evaluation_assignment", assignment_id, "update",
             old_value=old, new_value={**new, "status": new_status},
             reason="admin updated evaluation assignment")
        db.commit()
        return jsonify({"ok": True, "status": new_status})
    finally:
        db.close()


@bp.delete("/evaluation-assignments/<int:assignment_id>")
@roles_required("admin")
def delete_assignment(assignment_id):
    """Admin deletes an evaluation assignment. Answers and approvals cascade
    via FK; related notifications are removed as well."""
    db = get_db()
    try:
        detail = _assignment_detail(db, assignment_id)
        if not detail:
            return jsonify({"error": "Not found"}), 404
        db.execute(
            "DELETE FROM notifications WHERE entity_type='evaluation' AND entity_id=?",
            (assignment_id,))
        db.execute("DELETE FROM evaluation_assignments WHERE id=?", (assignment_id,))
        _log(db, "evaluation_assignment", assignment_id, "delete",
             old_value={"form_id": detail["form_id"], "employee_id": detail["employee_id"],
                        "cycle_id": detail["cycle_id"], "status": detail["status"]},
             reason=f"admin deleted evaluation assignment for {detail['employee']['full_name']}")
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()

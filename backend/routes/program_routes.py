import json

from flask import Blueprint, request, jsonify, g

from database import get_db, rows_to_list, row_to_dict
from auth import login_required, roles_required, can_view_employee
from scoring import _activity_score, compute_activity_kpi_score

bp = Blueprint("program_routes", __name__, url_prefix="/api/programs")

MAX_ACTIVITY_DEPTH = 5


# ---- Helpers ----

def _log(db, entity_type, entity_id, action, old_value=None, new_value=None):
    db.execute(
        "INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value, changed_by) "
        "VALUES (?,?,?,?,?,?)",
        (entity_type, entity_id, action, json.dumps(old_value, default=str) if old_value else None,
         json.dumps(new_value, default=str) if new_value else None, g.user.get("username", "system")),
    )


def _get_depth(db, activity_id):
    depth = 0
    current = activity_id
    while current is not None:
        row = db.execute("SELECT parent_id FROM program_activities WHERE id=?", (current,)).fetchone()
        if not row or row["parent_id"] is None:
            break
        current = row["parent_id"]
        depth += 1
    return depth


def _validate_parent(db, program_id, parent_id, exclude_activity_id=None):
    if parent_id is None:
        return
    if parent_id == exclude_activity_id:
        raise ValueError("A activity cannot be its own parent")
    parent = db.execute(
        "SELECT id, program_id FROM program_activities WHERE id=?", (parent_id,)
    ).fetchone()
    if not parent:
        raise ValueError("Parent activity does not exist")
    if parent["program_id"] != program_id:
        raise ValueError("Parent activity belongs to a different program")


def _is_descendant(db, ancestor_id, candidate_id):
    visited = set()
    queue = [ancestor_id]
    while queue:
        current = queue.pop(0)
        if current in visited:
            continue
        visited.add(current)
        children = db.execute(
            "SELECT id FROM program_activities WHERE parent_id=?", (current,)
        ).fetchall()
        for child in children:
            if child["id"] == candidate_id:
                return True
            queue.append(child["id"])
    return False


def _check_depth_limit(db, parent_id):
    if parent_id is None:
        return
    depth = _get_depth(db, parent_id) + 1
    if depth >= MAX_ACTIVITY_DEPTH:
        raise ValueError(f"Maximum activity nesting depth of {MAX_ACTIVITY_DEPTH} reached")


def _can_assign_to(db, assigner_id, assignee_id):
    if assigner_id == assignee_id:
        return True
    rel = db.execute(
        "SELECT 1 FROM reporting_relationships "
        "WHERE employee_id=? AND supervisor_id=? AND relationship_type='primary' AND is_active=1 "
        "LIMIT 1",
        (assignee_id, assigner_id),
    ).fetchone()
    if rel:
        return True
    emp = db.execute("SELECT manager_id FROM employees WHERE id=?", (assignee_id,)).fetchone()
    if emp and emp["manager_id"] == assigner_id:
        return True
    return False


def _get_assignable_employees(db, assigner_id):
    rows = rows_to_list(
        db.execute(
            "SELECT e.id, e.full_name, d.name as department_name "
            "FROM employees e LEFT JOIN departments d ON d.id = e.department_id "
            "WHERE e.id != ? AND ("
            "  EXISTS (SELECT 1 FROM reporting_relationships "
            "          WHERE employee_id=e.id AND supervisor_id=? "
            "          AND relationship_type='primary' AND is_active=1)"
            "  OR e.manager_id=?"
            ") ORDER BY e.full_name",
            (assigner_id, assigner_id, assigner_id),
        ).fetchall()
    )
    return rows


def _is_assigner_or_supervisor(db, activity_id, user_id):
    activity = db.execute("SELECT assigned_by FROM program_activities WHERE id=?", (activity_id,)).fetchone()
    if not activity:
        return False
    if activity["assigned_by"] == user_id:
        return True
    if activity["assigned_by"] is None:
        # NULL assigned_by: only program owner or admin can reassign
        proj = db.execute(
            "SELECT p.owner_id FROM program_activities t JOIN programs p ON p.id=t.program_id WHERE t.id=?",
            (activity_id,),
        ).fetchone()
        if proj and (proj["owner_id"] == user_id or g.user["role"] == "admin"):
            return True
        return False
    return _can_assign_to(db, user_id, activity["assigned_by"])


def _activity_tree(db, program_id):
    activities = rows_to_list(
        db.execute(
            "SELECT t.*, e.full_name as assignee_name, "
            "a.full_name as assigned_by_name "
            "FROM program_activities t "
            "LEFT JOIN employees e ON e.id = t.assignee_id "
            "LEFT JOIN employees a ON a.id = t.assigned_by "
            "WHERE t.program_id=? ORDER BY t.id",
            (program_id,),
        ).fetchall()
    )
    activity_map = {t["id"]: {**t, "children": [], "kpis": []} for t in activities}
    roots = []
    for t in activities:
        kpis = rows_to_list(
            db.execute("SELECT * FROM activity_kpis WHERE activity_id=?", (t["id"],)).fetchall()
        )
        activity_map[t["id"]]["kpis"] = kpis
        if t["parent_id"] and t["parent_id"] in activity_map:
            activity_map[t["parent_id"]]["children"].append(activity_map[t["id"]])
        else:
            roots.append(activity_map[t["id"]])
    return roots


def _has_children(db, activity_id):
    row = db.execute("SELECT 1 FROM program_activities WHERE parent_id=? LIMIT 1", (activity_id,)).fetchone()
    return row is not None


def _has_kpis(db, activity_id):
    row = db.execute("SELECT 1 FROM activity_kpis WHERE activity_id=? LIMIT 1", (activity_id,)).fetchone()
    return row is not None


def _propagate_progress(db, activity_id):
    children = rows_to_list(
        db.execute("SELECT id, weight, progress_pct FROM program_activities WHERE parent_id=?", (activity_id,)).fetchall()
    )
    if not children:
        return
    total_w = sum(c["weight"] or 1 for c in children)
    avg = sum((c["progress_pct"] or 0) * (c["weight"] or 1) for c in children) / total_w if total_w else 0
    db.execute("UPDATE program_activities SET progress_pct=? WHERE id=?", (round(avg, 1), activity_id))
    parent = db.execute("SELECT parent_id FROM program_activities WHERE id=?", (activity_id,)).fetchone()
    if parent and parent["parent_id"]:
        _propagate_progress(db, parent["parent_id"])


def _recalc_progress_from_kpis(db, activity_id):
    """Recalculate a activity's progress_pct from its KPI actuals, then propagate up."""
    kpis = rows_to_list(
        db.execute("SELECT * FROM activity_kpis WHERE activity_id=?", (activity_id,)).fetchall()
    )
    if not kpis:
        db.execute("UPDATE program_activities SET progress_pct=0 WHERE id=?", (activity_id,))
        activity = db.execute("SELECT parent_id FROM program_activities WHERE id=?", (activity_id,)).fetchone()
        if activity and activity["parent_id"]:
            _propagate_progress(db, activity["parent_id"])
        return
    for k in kpis:
        k["achievement_pct"] = compute_activity_kpi_score(k)
    total_w = sum(k["weight"] or 1 for k in kpis)
    avg = sum(k["achievement_pct"] * (k["weight"] or 1) for k in kpis) / total_w if total_w else 0
    db.execute("UPDATE program_activities SET progress_pct=? WHERE id=?", (round(avg, 1), activity_id))
    _auto_set_activity_status(db, activity_id, avg)
    activity = db.execute("SELECT parent_id FROM program_activities WHERE id=?", (activity_id,)).fetchone()
    if activity and activity["parent_id"]:
        _propagate_progress(db, activity["parent_id"])


def _auto_set_activity_status(db, activity_id, progress_pct):
    """Derive activity status from progress and due date."""
    activity = db.execute("SELECT status, due_date FROM program_activities WHERE id=?", (activity_id,)).fetchone()
    if not activity or activity["status"] == "cancelled":
        return
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    due_passed = activity["due_date"] and activity["due_date"] < now
    if progress_pct >= 100:
        new_status = "completed"
    elif progress_pct > 0:
        new_status = "on_hold" if due_passed else "in_progress"
    else:
        new_status = "on_hold" if due_passed else "not_started"
    if new_status != activity["status"]:
        db.execute("UPDATE program_activities SET status=? WHERE id=?", (new_status, activity_id))


# ---- Assignable Employees ----

@bp.get("/assignable")
@login_required
def assignable_employees():
    db = get_db()
    try:
        rows = _get_assignable_employees(db, g.user["employee_id"])
        return jsonify(rows)
    finally:
        db.close()


# ---- Programs ----

@bp.get("")
@login_required
def list_programs():
    cycle_id = request.args.get("cycle_id", type=int)
    db = get_db()
    try:
        where = "WHERE p.status != 'cancelled'"
        params = []
        if cycle_id:
            where += " AND p.cycle_id=?"
            params.append(cycle_id)
        if g.user["role"] == "manager":
            where += " AND (p.owner_id=? OR EXISTS (SELECT 1 FROM program_activities pt WHERE pt.program_id=p.id AND pt.assignee_id=?))"
            params.extend([g.user["employee_id"], g.user["employee_id"]])
        elif g.user["role"] == "employee":
            where += " AND EXISTS (SELECT 1 FROM program_activities pt WHERE pt.program_id=p.id AND pt.assignee_id=?)"
            params.append(g.user["employee_id"])
        rows = rows_to_list(
            db.execute(
                f"SELECT p.*, e.full_name as owner_name, "
                f"(SELECT COUNT(*) FROM program_activities WHERE program_id=p.id) as activity_count, "
                f"(SELECT COUNT(*) FROM program_activities WHERE program_id=p.id AND status='completed') as completed_activities "
                f"FROM programs p LEFT JOIN employees e ON e.id=p.owner_id {where} ORDER BY p.created_at DESC",
                params,
            ).fetchall()
        )
        return jsonify(rows)
    finally:
        db.close()


@bp.post("")
@roles_required("admin", "manager", "executive")
def create_program():
    data = request.get_json(force=True) or {}
    if not data.get("name"):
        return jsonify({"error": "name required"}), 400
    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO programs (name, description, owner_id, created_by, cycle_id, start_date, due_date, status, weight) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (
                data["name"], data.get("description"), data.get("owner_id", g.user["employee_id"]),
                g.user["employee_id"],
                data.get("cycle_id"), data.get("start_date"), data.get("due_date"),
                data.get("status", "planning"), data.get("weight", 1),
            ),
        )
        _log(db, "program", cur.lastrowid, "create", new_value=data)
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201
    finally:
        db.close()


@bp.get("/<int:program_id>")
@login_required
def get_program(program_id):
    db = get_db()
    try:
        proj = row_to_dict(
            db.execute(
                "SELECT p.*, e.full_name as owner_name FROM programs p "
                "LEFT JOIN employees e ON e.id=p.owner_id WHERE p.id=?",
                (program_id,),
            ).fetchone()
        )
        if not proj:
            return jsonify({"error": "Not found"}), 404
        proj["activities"] = _activity_tree(db, program_id)
        return jsonify(proj)
    finally:
        db.close()


@bp.put("/<int:program_id>")
@roles_required("admin", "manager", "executive")
def update_program(program_id):
    data = request.get_json(force=True) or {}
    db = get_db()
    try:
        proj = db.execute("SELECT * FROM programs WHERE id=?", (program_id,)).fetchone()
        if not proj:
            return jsonify({"error": "Not found"}), 404
        if proj["owner_id"] != g.user["employee_id"] and g.user["role"] != "admin":
            return jsonify({"error": "Only the program owner or an admin can update this program"}), 403
        fields = ["name", "description", "owner_id", "cycle_id", "start_date", "due_date", "status", "weight"]
        updates = {f: data[f] for f in fields if f in data}
        if updates:
            set_clause = ", ".join(f"{k}=?" for k in updates)
            db.execute(f"UPDATE programs SET {set_clause} WHERE id=?", (*updates.values(), program_id))
            _log(db, "program", program_id, "update", old_value=row_to_dict(proj), new_value=updates)
            db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


@bp.delete("/<int:program_id>")
@roles_required("admin", "manager", "executive")
def delete_program(program_id):
    db = get_db()
    try:
        proj = db.execute("SELECT * FROM programs WHERE id=?", (program_id,)).fetchone()
        if not proj:
            return jsonify({"error": "Not found"}), 404
        if proj["owner_id"] != g.user["employee_id"] and g.user["role"] != "admin":
            return jsonify({"error": "Only the program owner or an admin can delete this program"}), 403
        db.execute("DELETE FROM programs WHERE id=?", (program_id,))
        _log(db, "program", program_id, "delete", old_value=row_to_dict(proj))
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


# ---- Activities ----

@bp.post("/<int:program_id>/activities")
@roles_required("admin", "manager", "executive")
def create_activity(program_id):
    data = request.get_json(force=True) or {}
    if not data.get("title"):
        return jsonify({"error": "title required"}), 400
    db = get_db()
    try:
        proj = db.execute("SELECT id, status FROM programs WHERE id=?", (program_id,)).fetchone()
        if not proj:
            return jsonify({"error": "Program not found"}), 404
        if proj["status"] in ("completed", "cancelled"):
            return jsonify({"error": f"Cannot add activities to a {proj['status']} program"}), 400

        parent_id = data.get("parent_id")
        try:
            _validate_parent(db, program_id, parent_id)
            _check_depth_limit(db, parent_id)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

        assignee_id = data.get("assignee_id")
        if assignee_id:
            if not _can_assign_to(db, g.user["employee_id"], assignee_id):
                return jsonify({"error": "You can only assign activities to your direct reports"}), 403

        cur = db.execute(
            "INSERT INTO program_activities (program_id, parent_id, title, description, assignee_id, "
            "start_date, due_date, status, progress_pct, weight, assigned_by) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                program_id, parent_id, data["title"], data.get("description"),
                assignee_id, data.get("start_date"), data.get("due_date"),
                data.get("status", "not_started"), data.get("progress_pct", 0),
                data.get("weight", 1), g.user["employee_id"],
            ),
        )
        _log(db, "program_activity", cur.lastrowid, "create", new_value=data)
        if parent_id:
            _propagate_progress(db, parent_id)
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201
    finally:
        db.close()


@bp.put("/activities/<int:activity_id>")
@roles_required("admin", "manager", "executive")
def update_activity(activity_id):
    data = request.get_json(force=True) or {}
    db = get_db()
    try:
        activity = db.execute("SELECT * FROM program_activities WHERE id=?", (activity_id,)).fetchone()
        if not activity:
            return jsonify({"error": "Not found"}), 404

        if "progress_pct" in data:
            if _has_children(db, activity_id) or _has_kpis(db, activity_id):
                return jsonify({
                    "error": "progress_pct is read-only for activities with children or KPIs. "
                             "Use POST /activities/<id>/progress to log progress, or update KPI actual values."
                }), 400
            data["progress_pct"] = max(0.0, min(100.0, float(data["progress_pct"])))

        if "assignee_id" in data and data["assignee_id"] != activity["assignee_id"]:
            if not _is_assigner_or_supervisor(db, activity_id, g.user["employee_id"]):
                return jsonify({"error": "Only the person who assigned this activity (or their supervisor) can reassign it"}), 403
            if data["assignee_id"]:
                if not _can_assign_to(db, g.user["employee_id"], data["assignee_id"]):
                    return jsonify({"error": "You can only assign activities to your direct reports"}), 403

        if "parent_id" in data and data["parent_id"] != activity["parent_id"]:
            try:
                _validate_parent(db, activity["program_id"], data["parent_id"], exclude_activity_id=activity_id)
                if data["parent_id"] and _is_descendant(db, activity_id, data["parent_id"]):
                    return jsonify({"error": "Cannot reassign to a descendant activity (creates cycle)"}), 400
                _check_depth_limit(db, data["parent_id"])
            except ValueError as e:
                return jsonify({"error": str(e)}), 400

        fields = ["title", "description", "assignee_id", "start_date", "due_date",
                  "status", "progress_pct", "weight", "parent_id"]
        updates = {f: data[f] for f in fields if f in data}
        if updates:
            set_clause = ", ".join(f"{k}=?" for k in updates)
            db.execute(f"UPDATE program_activities SET {set_clause} WHERE id=?", (*updates.values(), activity_id))
            _log(db, "program_activity", activity_id, "update", old_value=row_to_dict(activity), new_value=updates)
            # Recalculate old parent progress
            if activity["parent_id"]:
                _propagate_progress(db, activity["parent_id"])
            # Recalculate new parent progress if reparented
            new_parent = data.get("parent_id")
            if new_parent and new_parent != activity["parent_id"]:
                _propagate_progress(db, new_parent)
            db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


@bp.delete("/activities/<int:activity_id>")
@roles_required("admin", "manager", "executive")
def delete_activity(activity_id):
    db = get_db()
    try:
        activity = db.execute("SELECT * FROM program_activities WHERE id=?", (activity_id,)).fetchone()
        if not activity:
            return jsonify({"error": "Not found"}), 404
        parent_id = activity["parent_id"]
        db.execute("DELETE FROM program_activities WHERE id=?", (activity_id,))
        _log(db, "program_activity", activity_id, "delete", old_value=row_to_dict(activity))
        if parent_id:
            _propagate_progress(db, parent_id)
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


# ---- Activity KPIs ----

@bp.get("/activities/<int:activity_id>/kpis")
@login_required
def list_activity_kpis(activity_id):
    db = get_db()
    try:
        rows = rows_to_list(
            db.execute("SELECT * FROM activity_kpis WHERE activity_id=? ORDER BY id", (activity_id,)).fetchall()
        )
        return jsonify(rows)
    finally:
        db.close()


@bp.post("/activities/<int:activity_id>/kpis")
@roles_required("admin", "manager", "executive")
def create_activity_kpi(activity_id):
    data = request.get_json(force=True) or {}
    if not data.get("name") or not data.get("kpi_type"):
        return jsonify({"error": "name and kpi_type required"}), 400
    db = get_db()
    try:
        activity = db.execute("SELECT id FROM program_activities WHERE id=?", (activity_id,)).fetchone()
        if not activity:
            return jsonify({"error": "Activity not found"}), 404
        cur = db.execute(
            "INSERT INTO activity_kpis (activity_id, name, kpi_type, target_value, actual_value, unit, weight, direction) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (
                activity_id, data["name"], data["kpi_type"], data.get("target_value"),
                data.get("actual_value"), data.get("unit"), data.get("weight", 1),
                data.get("direction", "higher_is_better"),
            ),
        )
        _log(db, "activity_kpi", cur.lastrowid, "create", new_value=data)
        if data.get("actual_value") is not None:
            _recalc_progress_from_kpis(db, activity_id)
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201
    finally:
        db.close()


@bp.put("/kpis/<int:kpi_id>")
@login_required
def update_activity_kpi(kpi_id):
    data = request.get_json(force=True) or {}
    db = get_db()
    try:
        kpi = db.execute("SELECT * FROM activity_kpis WHERE id=?", (kpi_id,)).fetchone()
        if not kpi:
            return jsonify({"error": "Not found"}), 404
        is_manager_like = g.user["role"] in ("admin", "manager", "executive")
        if is_manager_like:
            fields = ["name", "kpi_type", "target_value", "actual_value", "unit", "weight", "direction"]
            updates = {f: data[f] for f in fields if f in data}
        else:
            activity = db.execute(
                "SELECT assignee_id FROM program_activities WHERE id=?", (kpi["activity_id"],)
            ).fetchone()
            if not activity or activity["assignee_id"] != g.user["employee_id"]:
                return jsonify({"error": "You can only update KPIs on activities assigned to you"}), 403
            if any(f in data for f in ("name", "kpi_type", "target_value", "unit", "weight", "direction")):
                return jsonify({"error": "Employees can only update actual_value"}), 403
            if "actual_value" not in data:
                return jsonify({"error": "Nothing to update"}), 400
            updates = {"actual_value": data["actual_value"]}
        if updates:
            set_clause = ", ".join(f"{k}=?" for k in updates)
            db.execute(f"UPDATE activity_kpis SET {set_clause} WHERE id=?", (*updates.values(), kpi_id))
            _log(db, "activity_kpi", kpi_id, "update", old_value=row_to_dict(kpi), new_value=updates)
            if "actual_value" in updates:
                _recalc_progress_from_kpis(db, kpi["activity_id"])
            db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


@bp.delete("/kpis/<int:kpi_id>")
@roles_required("admin", "manager", "executive")
def delete_activity_kpi(kpi_id):
    db = get_db()
    try:
        kpi = db.execute("SELECT * FROM activity_kpis WHERE id=?", (kpi_id,)).fetchone()
        if not kpi:
            return jsonify({"error": "Not found"}), 404
        activity_id = kpi["activity_id"]
        db.execute("DELETE FROM activity_kpis WHERE id=?", (kpi_id,))
        _log(db, "activity_kpi", kpi_id, "delete", old_value=row_to_dict(kpi))
        _recalc_progress_from_kpis(db, activity_id)
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


# ---- Progress Logs ----

@bp.post("/activities/<int:activity_id>/progress")
@roles_required("admin", "manager", "executive")
def log_progress(activity_id):
    data = request.get_json(force=True) or {}
    if "progress_pct" not in data:
        return jsonify({"error": "progress_pct required"}), 400
    progress = max(0.0, min(100.0, float(data["progress_pct"])))
    db = get_db()
    try:
        activity = db.execute("SELECT * FROM program_activities WHERE id=?", (activity_id,)).fetchone()
        if not activity:
            return jsonify({"error": "Not found"}), 404
        cur = db.execute(
            "INSERT INTO activity_progress_logs (activity_id, recorded_by, progress_pct, notes) VALUES (?,?,?,?)",
            (activity_id, g.user["employee_id"], progress, data.get("notes")),
        )
        db.execute("UPDATE program_activities SET progress_pct=? WHERE id=?", (progress, activity_id))
        _log(db, "program_activity", activity_id, "progress", new_value={"progress_pct": progress, "notes": data.get("notes")})
        if activity["parent_id"]:
            _propagate_progress(db, activity["parent_id"])
        db.commit()
        return jsonify({"id": cur.lastrowid, "progress_pct": progress}), 201
    finally:
        db.close()


@bp.get("/activities/<int:activity_id>/progress")
@login_required
def list_progress(activity_id):
    db = get_db()
    try:
        rows = rows_to_list(
            db.execute(
                "SELECT pl.*, e.full_name as recorded_by_name FROM activity_progress_logs pl "
                "LEFT JOIN employees e ON e.id=pl.recorded_by WHERE pl.activity_id=? ORDER BY pl.created_at DESC",
                (activity_id,),
            ).fetchall()
        )
        return jsonify(rows)
    finally:
        db.close()


# ---- Score Preview ----

@bp.get("/<int:program_id>/score")
@login_required
def program_score(program_id):
    db = get_db()
    try:
        proj = db.execute("SELECT id, name FROM programs WHERE id=?", (program_id,)).fetchone()
        if not proj:
            return jsonify({"error": "Not found"}), 404
        roots = rows_to_list(
            db.execute(
                "SELECT id, title, weight, assignee_id FROM program_activities "
                "WHERE program_id=? AND parent_id IS NULL",
                (program_id,),
            ).fetchall()
        )
        activity_scores = []
        for t in roots:
            ts = _activity_score(db, t["id"])
            activity_scores.append({
                "activity": t["title"],
                "activity_id": t["id"],
                "assignee_id": t["assignee_id"],
                "score": round(ts, 2) if ts is not None else None,
                "weight": t["weight"] or 1,
            })
        valid = [t for t in activity_scores if t["score"] is not None]
        if valid:
            total_w = sum(t["weight"] for t in valid)
            overall = sum(t["score"] * t["weight"] for t in valid) / total_w
        else:
            overall = None
        return jsonify({
            "program_id": program_id,
            "program": proj["name"],
            "score": round(overall, 2) if overall is not None else None,
            "activities": activity_scores,
        })
    finally:
        db.close()

import json
import re
import secrets
import sqlite3
from datetime import date

from flask import Blueprint, request, jsonify, g

from database import get_db, rows_to_list, row_to_dict
from auth import roles_required, login_required, can_view_employee, hash_password
from chain import resolve_chain, direct_reports, unit_head, is_unit_descendant

bp = Blueprint("org_routes", __name__, url_prefix="/api")


class UsernameTaken(Exception):
    pass


def _log(db, entity_type, entity_id, action, old_value=None, new_value=None):
    db.execute(
        "INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value, changed_by) "
        "VALUES (?,?,?,?,?,?)",
        (entity_type, entity_id, action, json.dumps(old_value, default=str) if old_value else None,
         json.dumps(new_value, default=str) if new_value else None, g.user.get("username", "system")),
    )


def _role_id(db, role):
    row = db.execute("SELECT id FROM roles WHERE name=?", (role,)).fetchone()
    return row["id"] if row else None


def _unique_username(db, base):
    if not db.execute("SELECT 1 FROM users WHERE username=?", (base,)).fetchone():
        return base
    for i in range(2, 1000):
        candidate = f"{base}{i}"
        if not db.execute("SELECT 1 FROM users WHERE username=?", (candidate,)).fetchone():
            return candidate
    return f"{base}{secrets.randbelow(10**6)}"


def _username_from_email(db, email):
    base = re.sub(r"[^a-z0-9_.-]", ".", (email or "").split("@")[0].strip().lower()) or "user"
    return _unique_username(db, base)


def _ensure_user(db, employee_id, email, username=None, password=None, role=None, generate_password_if_missing=False):
    """Create or update an employee's login.
    If user exists:
      - role is updated only if explicitly provided (non-empty); otherwise current role is preserved.
      - username is updated only if explicitly provided (non-empty); otherwise current username is preserved.
      - password is updated if provided; if not provided and generate_password_if_missing=True, a temp password is generated;
        otherwise the existing password is kept.
    If user does not exist:
      - role defaults to "employee" if not provided.
      - password defaults to a generated temp password if not provided.
      - username defaults to email prefix if not provided.
    """
    existing = db.execute("SELECT * FROM users WHERE employee_id=?", (employee_id,)).fetchone()
    temp = None

    if existing:
        target_role = (role.strip().lower() if role and role.strip() else existing["role"])
        rid = _role_id(db, target_role)
        if not rid:
            valid_roles = [r["name"] for r in db.execute("SELECT name FROM roles ORDER BY name").fetchall()]
            if valid_roles:
                raise ValueError(f"role must be one of: {', '.join(valid_roles)}")
            elif target_role not in ("admin", "manager", "employee", "executive"):
                raise ValueError("role must be one of: admin, manager, employee, executive")

        uname = (username.strip() if username and username.strip() else existing["username"])
        conflict = db.execute(
            "SELECT 1 FROM users WHERE username=? AND employee_id<>?",
            (uname, employee_id)
        ).fetchone()
        if conflict:
            raise UsernameTaken("That username is already in use")

        sets = []
        params = []
        password_set = False

        if password and password.strip():
            if len(password) < 8:
                raise ValueError("Password must be at least 8 characters")
            new_hash = hash_password(password)
            sets.append("password_hash=?")
            params.append(new_hash)
            password_set = True
        elif generate_password_if_missing:
            temp = secrets.token_urlsafe(8)
            new_hash = hash_password(temp)
            sets.append("password_hash=?")
            params.append(new_hash)
            password_set = True

        if uname != existing["username"]:
            sets.append("username=?")
            params.append(uname)

        if target_role != existing["role"]:
            sets.append("role=?")
            params.append(target_role)

        if rid and rid != existing["role_id"]:
            sets.append("role_id=?")
            params.append(rid)

        if sets:
            params.append(existing["id"])
            db.execute(f"UPDATE users SET {', '.join(sets)} WHERE id=?", params)

        return {
            "username": uname,
            "role": target_role,
            "temp_password": temp,
            "created": False,
            "password_set": password_set,
        }
    else:
        target_role = (role.strip().lower() if role and role.strip() else "employee")
        rid = _role_id(db, target_role)
        if not rid:
            valid_roles = [r["name"] for r in db.execute("SELECT name FROM roles ORDER BY name").fetchall()]
            if valid_roles:
                raise ValueError(f"role must be one of: {', '.join(valid_roles)}")
            elif target_role not in ("admin", "manager", "employee", "executive"):
                raise ValueError("role must be one of: admin, manager, employee, executive")

        if username and username.strip():
            uname = username.strip()
            conflict = db.execute("SELECT 1 FROM users WHERE username=?", (uname,)).fetchone()
            if conflict:
                raise UsernameTaken("That username is already in use")
        else:
            uname = _username_from_email(db, email)

        if password and password.strip():
            if len(password) < 8:
                raise ValueError("Password must be at least 8 characters")
            new_hash = hash_password(password)
        else:
            temp = secrets.token_urlsafe(8)
            new_hash = hash_password(temp)

        db.execute(
            "INSERT INTO users (username, password_hash, role, employee_id, role_id) VALUES (?,?,?,?,?)",
            (uname, new_hash, target_role, employee_id, rid)
        )
        return {
            "username": uname,
            "role": target_role,
            "temp_password": temp,
            "created": True,
            "password_set": True,
        }


# ---------- Departments ----------

@bp.get("/departments")
@login_required
def list_departments():
    db = get_db()
    try:
        return jsonify(rows_to_list(db.execute("SELECT * FROM departments ORDER BY name").fetchall()))
    finally:
        db.close()


@bp.post("/departments")
@roles_required("admin")
def create_department():
    data = request.get_json(force=True) or {}
    if not data.get("name"):
        return jsonify({"error": "name required"}), 400
    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO departments (name, parent_id) VALUES (?, ?)",
            (data["name"], data.get("parent_id")),
        )
        
        _log(db, "department", cur.lastrowid, "create", new_value=data)
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201
    finally:
        db.close()


# ---------- Employees ----------

@bp.get("/employees")
@login_required
def list_employees():
    db = get_db()
    try:
        if g.user["role"] in ("admin", "executive"):
            rows = db.execute(
                "SELECT e.*, d.name as department_name, u.username, "
                "COALESCE(r.name, u.role, 'employee') AS role, "
                "CASE WHEN u.id IS NULL THEN 0 ELSE 1 END AS has_account FROM employees e "
                "LEFT JOIN departments d ON d.id = e.department_id "
                "LEFT JOIN users u ON u.employee_id = e.id "
                "LEFT JOIN roles r ON r.id = u.role_id ORDER BY e.full_name"
            ).fetchall()
        elif g.user["role"] == "manager":
            rows = db.execute(
                "SELECT e.*, d.name as department_name, u.username, "
                "COALESCE(r.name, u.role, 'employee') AS role, "
                "CASE WHEN u.id IS NULL THEN 0 ELSE 1 END AS has_account FROM employees e "
                "LEFT JOIN departments d ON d.id = e.department_id "
                "LEFT JOIN users u ON u.employee_id = e.id "
                "LEFT JOIN roles r ON r.id = u.role_id "
                "WHERE e.manager_id = ? OR e.id = ? ORDER BY e.full_name",
                (g.user["employee_id"], g.user["employee_id"]),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT e.*, d.name as department_name, u.username, "
                "COALESCE(r.name, u.role, 'employee') AS role, "
                "CASE WHEN u.id IS NULL THEN 0 ELSE 1 END AS has_account FROM employees e "
                "LEFT JOIN departments d ON d.id = e.department_id "
                "LEFT JOIN users u ON u.employee_id = e.id "
                "LEFT JOIN roles r ON r.id = u.role_id "
                "WHERE e.id = ?",
                (g.user["employee_id"],),
            ).fetchall()
        return jsonify(rows_to_list(rows))
    finally:
        db.close()


@bp.get("/employees/<int:employee_id>")
@login_required
def get_employee(employee_id):
    if not can_view_employee(g.user, employee_id):
        return jsonify({"error": "Forbidden"}), 403
    db = get_db()
    try:
        row = db.execute(
            "SELECT e.*, d.name as department_name, m.full_name as manager_name, "
            "u.username, COALESCE(r.name, u.role, 'employee') AS role, "
            "CASE WHEN u.id IS NULL THEN 0 ELSE 1 END AS has_account FROM employees e "
            "LEFT JOIN departments d ON d.id = e.department_id "
            "LEFT JOIN employees m ON m.id = e.manager_id "
            "LEFT JOIN users u ON u.employee_id = e.id "
            "LEFT JOIN roles r ON r.id = u.role_id WHERE e.id = ?",
            (employee_id,),
        ).fetchone()
        if not row:
            return jsonify({"error": "Not found"}), 404
        return jsonify(row_to_dict(row))
    finally:
        db.close()


@bp.post("/employees")
@roles_required("admin")
def create_employee():
    data = request.get_json(force=True) or {}
    required = ["full_name", "email"]
    missing = [f for f in required if not data.get(f)]
    if missing:
        return jsonify({"error": f"missing fields: {missing}"}), 400
    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO employees (full_name, email, position, job_grade, department_id, manager_id, "
            "employment_status, date_joined) VALUES (?,?,?,?,?,?,?,?)",
            (
                data["full_name"], data["email"], data.get("position"), data.get("job_grade"),
                data.get("department_id"), data.get("manager_id"),
                data.get("employment_status", "active"), data.get("date_joined"),
            ),
        )
        try:
            acct = _ensure_user(
                db, cur.lastrowid, data["email"],
                username=data.get("username"), password=data.get("password"), role=data.get("role"),
                generate_password_if_missing=True,
            )
        except UsernameTaken as e:
            db.rollback()
            return jsonify({"error": str(e)}), 409
        except ValueError as e:
            db.rollback()
            return jsonify({"error": str(e)}), 400
        _log(db, "employee", cur.lastrowid, "create", new_value=data)
        db.commit()
        resp = {"id": cur.lastrowid, "username": acct["username"]}
        if acct.get("temp_password"):
            resp["temp_password"] = acct["temp_password"]
            resp["password_generated"] = True
        return jsonify(resp), 201
    finally:
        db.close()


@bp.post("/employees/<int:employee_id>/account")
@roles_required("admin")
def manage_account(employee_id):
    """Admin creates or resets an employee's login (username / role / password).
    A blank password generates a temporary one returned only once."""
    data = request.get_json(force=True) or {}
    db = get_db()
    try:
        emp = db.execute("SELECT * FROM employees WHERE id=?", (employee_id,)).fetchone()
        if not emp:
            return jsonify({"error": "Not found"}), 404
        try:
            acct = _ensure_user(
                db, employee_id, emp["email"],
                username=data.get("username"), password=data.get("password"), role=data.get("role"),
                generate_password_if_missing=True,
            )
        except UsernameTaken as e:
            return jsonify({"error": str(e)}), 409
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        _log(db, "employee", employee_id, "account",
             old_value={"employee_id": employee_id},
             new_value={"username": acct["username"], "role": acct["role"], "created": acct["created"],
                        "password_set": acct["password_set"]})
        db.commit()
        resp = {"ok": True, "username": acct["username"], "role": acct["role"],
                "account_created": acct["created"], "password_set": acct["password_set"]}
        if acct.get("temp_password"):
            resp["temp_password"] = acct["temp_password"]
            resp["password_generated"] = True
        return jsonify(resp)
    finally:
        db.close()


@bp.put("/employees/<int:employee_id>")
@roles_required("admin")
def update_employee(employee_id):
    data = request.get_json(force=True) or {}
    db = get_db()
    try:
        old = db.execute("SELECT * FROM employees WHERE id=?", (employee_id,)).fetchone()
        if not old:
            return jsonify({"error": "Not found"}), 404
        fields = ["full_name", "email", "position", "job_grade", "department_id",
                  "manager_id", "employment_status", "date_joined"]
        updates = {f: data[f] for f in fields if f in data}
        if updates:
            set_clause = ", ".join(f"{k}=?" for k in updates)
            db.execute(f"UPDATE employees SET {set_clause} WHERE id=?", (*updates.values(), employee_id))
            _log(db, "employee", employee_id, "update", old_value=row_to_dict(old), new_value=updates)

        resp = {"ok": True}
        emp_email = data.get("email") or old["email"]
        if any(k in data for k in ("username", "password", "role")):
            try:
                acct = _ensure_user(
                    db, employee_id, emp_email,
                    username=data.get("username"),
                    password=data.get("password"),
                    role=data.get("role"),
                    generate_password_if_missing=False,
                )
                if acct.get("temp_password"):
                    resp["temp_password"] = acct["temp_password"]
                    resp["username"] = acct["username"]
                    resp["password_generated"] = True
            except UsernameTaken as e:
                db.rollback()
                return jsonify({"error": str(e)}), 409
            except ValueError as e:
                db.rollback()
                return jsonify({"error": str(e)}), 400

        db.commit()
        return jsonify(resp)
    finally:
        db.close()


@bp.delete("/employees/<int:employee_id>")
@roles_required("admin")
def delete_employee(employee_id):
    """Admin hard-deletes an employee record and every dependency (login,
    goals/KPIs, evaluations, assignments, approvals, insights, scores, history).
    Refuses to delete your own account or someone with active direct reports."""
    db = get_db()
    try:
        emp = db.execute("SELECT * FROM employees WHERE id=?", (employee_id,)).fetchone()
        if not emp:
            return jsonify({"error": "Not found"}), 404
        if employee_id == g.user.get("employee_id"):
            return jsonify({"error": "You cannot delete your own account"}), 400
        reports = rows_to_list(db.execute(
            "SELECT id, full_name FROM employees WHERE manager_id=? AND employment_status='active'",
            (employee_id,)).fetchall())
        if reports:
            return jsonify({
                "error": "This person still manages active reports — reassign them first",
                "reports": [r["full_name"] for r in reports],
            }), 409

        # Login + notifications for that login.
        user_ids = [r["id"] for r in db.execute(
            "SELECT id FROM users WHERE employee_id=?", (employee_id,)).fetchall()]
        if user_ids:
            ph = ",".join("?" * len(user_ids))
            db.execute(f"DELETE FROM notifications WHERE user_id IN ({ph})", user_ids)
            db.execute(f"DELETE FROM users WHERE id IN ({ph})", user_ids)

        # Approval workflow tables (largely legacy; kept consistent).
        db.execute("DELETE FROM reporting_relationships WHERE employee_id=? OR supervisor_id=?",
                   (employee_id, employee_id))
        db.execute("UPDATE employee_org_history SET changed_by=NULL WHERE changed_by=?",
                   (employee_id,))
        db.execute("DELETE FROM employee_org_history WHERE employee_id=?", (employee_id,))
        db.execute("DELETE FROM delegations WHERE delegator_id=? OR delegate_id=?",
                   (employee_id, employee_id))
        request_ids = [r["id"] for r in db.execute(
            "SELECT id FROM approval_requests WHERE initiator_id=?", (employee_id,)).fetchall()]
        if request_ids:
            ph = ",".join("?" * len(request_ids))
            db.execute(f"DELETE FROM approval_requests WHERE id IN ({ph})", request_ids)
            db.execute(f"UPDATE evaluation_assignments SET approval_request_id=NULL "
                       f"WHERE approval_request_id IN ({ph})", request_ids)
        db.execute("UPDATE approval_actions SET actor_id=NULL WHERE actor_id=?", (employee_id,))

        # Performance data.
        db.execute("DELETE FROM goals WHERE employee_id=?", (employee_id,))
        db.execute("DELETE FROM kpis WHERE employee_id=?", (employee_id,))
        db.execute("DELETE FROM employee_competencies WHERE employee_id=?", (employee_id,))
        db.execute("DELETE FROM ai_insights WHERE employee_id=?", (employee_id,))
        db.execute("DELETE FROM performance_scores WHERE employee_id=?", (employee_id,))
        db.execute("DELETE FROM evaluations WHERE employee_id=? OR evaluator_id=?",
                   (employee_id, employee_id))

        # Evaluation assignments as subject or evaluator (+ notifications & cascades).
        aid_list = [r["id"] for r in db.execute(
            "SELECT id FROM evaluation_assignments WHERE employee_id=? OR evaluator_id=?",
            (employee_id, employee_id)).fetchall()]
        if aid_list:
            ph = ",".join("?" * len(aid_list))
            db.execute(
                f"DELETE FROM notifications WHERE entity_type='evaluation' AND entity_id IN ({ph})",
                aid_list)
            db.execute(f"DELETE FROM evaluation_assignments WHERE id IN ({ph})", aid_list)
        untracked = db.execute(
            "UPDATE evaluation_approvals SET approver_id=NULL WHERE approver_id=?",
            (employee_id,)).rowcount

        # Any (inactive) direct reports become managerless.
        db.execute("UPDATE employees SET manager_id=NULL WHERE manager_id=?", (employee_id,))

        db.execute("DELETE FROM employees WHERE id=?", (employee_id,))
        _log(db, "employee", employee_id, "delete",
             old_value={"full_name": emp["full_name"], "email": emp["email"],
                        "position": emp["position"]},
             new_value={"assignments_deleted": len(aid_list), "approvals_untracked": untracked,
                        "users_deleted": len(user_ids)})
        db.commit()
        return jsonify({"ok": True, "assignments_deleted": len(aid_list),
                        "approvals_untracked": untracked, "users_deleted": len(user_ids)})
    finally:
        db.close()


# ---------- Performance cycles ----------

@bp.get("/cycles")
@login_required
def list_cycles():
    db = get_db()
    try:
        return jsonify(rows_to_list(db.execute("SELECT * FROM performance_cycles ORDER BY start_date DESC").fetchall()))
    finally:
        db.close()


@bp.post("/cycles")
@roles_required("admin")
def create_cycle():
    data = request.get_json(force=True) or {}
    if not data.get("name"):
        return jsonify({"error": "name required"}), 400
    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO performance_cycles (name, start_date, end_date, status) VALUES (?,?,?,?)",
            (data["name"], data.get("start_date"), data.get("end_date"), data.get("status", "active")),
        )
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201
    finally:
        db.close()


# ---------- Audit log (admin only) ----------

@bp.get("/audit")
@roles_required("admin")
def list_audit():
    db = get_db()
    try:
        category = request.args.get("category", "all")
        try:
            limit = min(int(request.args.get("limit", 200)), 500)
        except ValueError:
            limit = 200
        action_map = {
            "create": ("create",),
            "update": ("update",),
            "delete": ("delete",),
            "score": ("recalculate", "calculated"),
            "auth": ("login", "logout"),
        }
        sql = "SELECT * FROM audit_log"
        params = []
        if category in action_map:
            placeholders = ",".join("?" for _ in action_map[category])
            sql += f" WHERE action IN ({placeholders})"
            params.extend(action_map[category])
        sql += " ORDER BY timestamp DESC, id DESC LIMIT ?"
        params.append(limit)
        rows = db.execute(sql, params).fetchall()
        return jsonify(rows_to_list(rows))
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Configurable hierarchy: level types (Directorate, Department, Section, ...)
# ---------------------------------------------------------------------------

@bp.get("/org/unit-types")
@login_required
def list_unit_types():
    db = get_db()
    try:
        rows = db.execute("SELECT * FROM org_unit_types ORDER BY level_order, name").fetchall()
        return jsonify(rows_to_list(rows))
    finally:
        db.close()


@bp.post("/org/unit-types")
@roles_required("admin")
def create_unit_type():
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    try:
        level = int(data.get("level_order", 0))
    except (TypeError, ValueError):
        level = 0
    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO org_unit_types (name, level_order, system_default) VALUES (?,?,?)",
            (name, level, 1 if data.get("system_default") else 0),
        )
        
        _log(db, "org_unit_type", cur.lastrowid, "create", new_value=data)
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201
    except sqlite3.IntegrityError:
        return jsonify({"error": "A level type with this name already exists"}), 400
    finally:
        db.close()


@bp.put("/org/unit-types/<int:unit_type_id>")
@roles_required("admin")
def update_unit_type(unit_type_id):
    data = request.get_json(force=True) or {}
    db = get_db()
    try:
        old = db.execute("SELECT * FROM org_unit_types WHERE id=?", (unit_type_id,)).fetchone()
        if not old:
            return jsonify({"error": "Not found"}), 404
        updates = {}
        if "name" in data and str(data.get("name") or "").strip():
            updates["name"] = data["name"].strip()
        if "level_order" in data:
            try:
                updates["level_order"] = int(data["level_order"])
            except (TypeError, ValueError):
                pass
        if updates:
            set_clause = ", ".join(f"{k}=?" for k in updates)
            db.execute(f"UPDATE org_unit_types SET {set_clause} WHERE id=?", (*updates.values(), unit_type_id))
            
            _log(db, "org_unit_type", unit_type_id, "update", old_value=row_to_dict(old), new_value=updates)
            db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


@bp.delete("/org/unit-types/<int:unit_type_id>")
@roles_required("admin")
def delete_unit_type(unit_type_id):
    db = get_db()
    try:
        used = db.execute(
            "SELECT COUNT(*) c FROM departments WHERE unit_type_id=?", (unit_type_id,)
        ).fetchone()["c"]
        if used:
            return jsonify({"error": f"Cannot delete: {used} org unit(s) use this level type"}), 400
        db.execute("DELETE FROM org_unit_types WHERE id=?", (unit_type_id,))
        
        _log(db, "org_unit_type", unit_type_id, "delete")
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Org unit tree
# ---------------------------------------------------------------------------

def _build_unit_tree(db):
    units = rows_to_list(
        db.execute(
            "SELECT d.*, ut.name AS unit_type_name, ut.level_order AS unit_level_order "
            "FROM departments d LEFT JOIN org_unit_types ut ON ut.id = d.unit_type_id "
            "ORDER BY d.name"
        ).fetchall()
    )
    by_id = {u["id"]: u for u in units}
    for u in units:
        u["children"] = []
        u["head"] = unit_head(u["id"], db)
        u["position_count"] = db.execute(
            "SELECT COUNT(*) c FROM positions WHERE org_unit_id=?", (u["id"],)
        ).fetchone()["c"]
        u["employee_count"] = db.execute(
            "SELECT COUNT(*) c FROM employees WHERE department_id=?", (u["id"],)
        ).fetchone()["c"]
    roots = []
    for u in units:
        parent = by_id.get(u["parent_id"])
        if parent is None:
            roots.append(u)
        else:
            parent["children"].append(u)
    return roots


def _check_level_order(db, parent_id, unit_type_id):
    """Returns an error string if nesting is out of sequence, else None."""
    if not parent_id or not unit_type_id:
        return None
    parent_type = db.execute(
        "SELECT ut.level_order FROM departments d JOIN org_unit_types ut ON ut.id=d.unit_type_id WHERE d.id=?",
        (parent_id,),
    ).fetchone()
    child_type = db.execute(
        "SELECT level_order FROM org_unit_types WHERE id=?", (unit_type_id,)
    ).fetchone()
    if parent_type and child_type and parent_type["level_order"] >= child_type["level_order"]:
        return ("Level ordering violated: a child unit's level must be deeper than its parent's. "
                "Enable override to allow matrix setups.")
    return None


@bp.get("/org/tree")
@login_required
def org_tree():
    db = get_db()
    try:
        return jsonify(_build_unit_tree(db))
    finally:
        db.close()


@bp.post("/org/units")
@roles_required("admin")
def create_org_unit():
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    parent_id = data.get("parent_id")
    unit_type_id = data.get("unit_type_id")
    db = get_db()
    try:
        if not bool(data.get("override")):
            err = _check_level_order(db, parent_id, unit_type_id)
            if err:
                return jsonify({"error": err}), 400
        cur = db.execute(
            "INSERT INTO departments (name, unit_type_id, parent_id, code, active) VALUES (?,?,?,?,1)",
            (name, unit_type_id, parent_id, data.get("code") or None),
        )
        
        _log(db, "department", cur.lastrowid, "create", new_value=data)
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201
    finally:
        db.close()


@bp.put("/org/units/<int:unit_id>")
@roles_required("admin")
def update_org_unit(unit_id):
    data = request.get_json(force=True) or {}
    db = get_db()
    try:
        old = db.execute("SELECT * FROM departments WHERE id=?", (unit_id,)).fetchone()
        if not old:
            return jsonify({"error": "Not found"}), 404
        updates = {}
        if "name" in data and str(data.get("name") or "").strip():
            updates["name"] = data["name"].strip()
        for f in ("unit_type_id", "parent_id", "code"):
            if f in data:
                updates[f] = data[f]
        if "active" in data:
            updates["active"] = 1 if data["active"] else 0
        if updates:
            set_clause = ", ".join(f"{k}=?" for k in updates)
            db.execute(f"UPDATE departments SET {set_clause} WHERE id=?", (*updates.values(), unit_id))
            
            _log(db, "department", unit_id, "update", old_value=row_to_dict(old), new_value=updates)
            db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


@bp.delete("/org/units/<int:unit_id>")
@roles_required("admin")
def delete_org_unit(unit_id):
    db = get_db()
    try:
        row = db.execute("SELECT * FROM departments WHERE id=?", (unit_id,)).fetchone()
        if not row:
            return jsonify({"error": "Not found"}), 404
        children = db.execute(
            "SELECT COUNT(*) c FROM departments WHERE parent_id=?", (unit_id,)
        ).fetchone()["c"]
        emps = db.execute(
            "SELECT COUNT(*) c FROM employees WHERE department_id=?", (unit_id,)
        ).fetchone()["c"]
        poss = db.execute(
            "SELECT COUNT(*) c FROM positions WHERE org_unit_id=?", (unit_id,)
        ).fetchone()["c"]
        if children or emps or poss:
            return jsonify({"error": "Cannot delete: unit has children, employees, or positions. Deactivate instead."}), 400
        db.execute("DELETE FROM departments WHERE id=?", (unit_id,))
        
        _log(db, "department", unit_id, "delete", old_value=row_to_dict(row))
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


@bp.post("/org/units/<int:unit_id>/move")
@roles_required("admin")
def move_org_unit(unit_id):
    data = request.get_json(force=True) or {}
    new_parent = data.get("parent_id")  # None -> becomes a root unit
    db = get_db()
    try:
        row = db.execute("SELECT * FROM departments WHERE id=?", (unit_id,)).fetchone()
        if not row:
            return jsonify({"error": "Not found"}), 404
        if new_parent is not None:
            if is_unit_descendant(db, new_parent, unit_id):
                return jsonify({"error": "Cannot move a unit under itself or its own descendant."}), 400
            if not bool(data.get("override")):
                err = _check_level_order(db, new_parent, row["unit_type_id"])
                if err:
                    return jsonify({"error": err}), 400
        db.execute("UPDATE departments SET parent_id=? WHERE id=?", (new_parent, unit_id))
        
        _log(db, "department", unit_id, "move", old_value=row_to_dict(row), new_value={"parent_id": new_parent})
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Positions
# ---------------------------------------------------------------------------

@bp.get("/org/positions")
@login_required
def list_positions():
    db = get_db()
    try:
        rows = db.execute(
            "SELECT p.*, d.name AS unit_name, e.full_name AS occupant_name, "
            "e.employment_status AS occupant_status FROM positions p "
            "LEFT JOIN departments d ON d.id = p.org_unit_id "
            "LEFT JOIN employees e ON e.position_id = p.id ORDER BY p.title"
        ).fetchall()
        return jsonify(rows_to_list(rows))
    finally:
        db.close()


@bp.post("/org/positions")
@roles_required("admin")
def create_position():
    data = request.get_json(force=True) or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "title required"}), 400
    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO positions (title, job_grade, org_unit_id, is_head, active) VALUES (?,?,?,?,1)",
            (title, data.get("job_grade"), data.get("org_unit_id"), 1 if data.get("is_head") else 0),
        )
        
        _log(db, "position", cur.lastrowid, "create", new_value=data)
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201
    finally:
        db.close()


@bp.put("/org/positions/<int:position_id>")
@roles_required("admin")
def update_position(position_id):
    data = request.get_json(force=True) or {}
    db = get_db()
    try:
        old = db.execute("SELECT * FROM positions WHERE id=?", (position_id,)).fetchone()
        if not old:
            return jsonify({"error": "Not found"}), 404
        updates = {}
        if "title" in data and str(data.get("title") or "").strip():
            updates["title"] = data["title"].strip()
        for f in ("job_grade", "org_unit_id"):
            if f in data:
                updates[f] = data[f]
        if "is_head" in data:
            updates["is_head"] = 1 if data["is_head"] else 0
        if "active" in data:
            updates["active"] = 1 if data["active"] else 0
        if updates:
            set_clause = ", ".join(f"{k}=?" for k in updates)
            db.execute(f"UPDATE positions SET {set_clause} WHERE id=?", (*updates.values(), position_id))
            
            _log(db, "position", position_id, "update", old_value=row_to_dict(old), new_value=updates)
            db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


@bp.delete("/org/positions/<int:position_id>")
@roles_required("admin")
def delete_position(position_id):
    db = get_db()
    try:
        occupant = db.execute(
            "SELECT COUNT(*) c FROM employees WHERE position_id=?", (position_id,)
        ).fetchone()["c"]
        if occupant:
            return jsonify({"error": "Cannot delete an occupied position. Unassign the employee first."}), 400
        db.execute("DELETE FROM positions WHERE id=?", (position_id,))
        
        _log(db, "position", position_id, "delete")
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Reporting relationships
# ---------------------------------------------------------------------------

@bp.get("/org/reporting-relationships")
@login_required
def list_reporting_relationships():
    db = get_db()
    try:
        where = ""
        params = []
        role = g.user["role"]
        if role not in ("admin", "executive"):
            if role == "manager":
                where = "WHERE r.supervisor_id = ? OR r.employee_id = ?"
                params = [g.user["employee_id"], g.user["employee_id"]]
            else:
                where = "WHERE r.employee_id = ?"
                params = [g.user["employee_id"]]
        rows = db.execute(
            "SELECT r.*, e.full_name AS employee_name, s.full_name AS supervisor_name "
            "FROM reporting_relationships r "
            "JOIN employees e ON e.id = r.employee_id "
            f"JOIN employees s ON s.id = r.supervisor_id {where} "
            "ORDER BY r.employee_id, r.id",
            params,
        ).fetchall()
        return jsonify(rows_to_list(rows))
    finally:
        db.close()


@bp.post("/org/reporting-relationships")
@roles_required("admin")
def create_reporting_relationship():
    data = request.get_json(force=True) or {}
    employee_id = data.get("employee_id")
    supervisor_id = data.get("supervisor_id")
    rtype = data.get("relationship_type") or "primary"
    if not employee_id or not supervisor_id:
        return jsonify({"error": "employee_id and supervisor_id required"}), 400
    valid_types = {"primary", "secondary", "functional", "administrative", "acting", "temporary"}
    if rtype not in valid_types:
        return jsonify({"error": f"relationship_type must be one of {sorted(valid_types)}"}), 400
    if employee_id == supervisor_id:
        return jsonify({"error": "An employee cannot be their own supervisor."}), 400
    db = get_db()
    try:
        # Keep a single active relationship per type.
        db.execute(
            "UPDATE reporting_relationships SET is_active=0 "
            "WHERE employee_id=? AND relationship_type=? AND is_active=1",
            (employee_id, rtype),
        )
        cur = db.execute(
            "INSERT INTO reporting_relationships (employee_id, supervisor_id, relationship_type, "
            "start_date, end_date, reason, is_active) VALUES (?,?,?,?,?,?,1)",
            (employee_id, supervisor_id, rtype, data.get("start_date"),
             data.get("end_date"), data.get("reason")),
        )
        if rtype == "primary":
            db.execute("UPDATE employees SET manager_id=? WHERE id=?", (supervisor_id, employee_id))
        
        _log(db, "reporting_relationship", cur.lastrowid, "create", new_value=data)
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201
    finally:
        db.close()


@bp.put("/org/reporting-relationships/<int:rid>")
@roles_required("admin")
def update_reporting_relationship(rid):
    data = request.get_json(force=True) or {}
    db = get_db()
    try:
        old = db.execute("SELECT * FROM reporting_relationships WHERE id=?", (rid,)).fetchone()
        if not old:
            return jsonify({"error": "Not found"}), 404
        updates = {}
        for f in ("employee_id", "supervisor_id", "relationship_type", "start_date", "end_date", "reason"):
            if f in data:
                updates[f] = data[f]
        if "is_active" in data:
            updates["is_active"] = 1 if data["is_active"] else 0
        if updates:
            set_clause = ", ".join(f"{k}=?" for k in updates)
            db.execute(f"UPDATE reporting_relationships SET {set_clause} WHERE id=?", (*updates.values(), rid))
            if old["relationship_type"] == "primary":
                if "supervisor_id" in updates:
                    db.execute("UPDATE employees SET manager_id=? WHERE id=?",
                               (updates["supervisor_id"], old["employee_id"]))
                if updates.get("is_active") == 0:
                    other = db.execute(
                        "SELECT COUNT(*) c FROM reporting_relationships WHERE employee_id=? "
                        "AND relationship_type='primary' AND is_active=1 AND id != ?",
                        (old["employee_id"], rid)).fetchone()["c"]
                    if other == 0:
                        db.execute("UPDATE employees SET manager_id=NULL WHERE id=?", (old["employee_id"],))
            
            _log(db, "reporting_relationship", rid, "update", old_value=row_to_dict(old), new_value=updates)
            db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


@bp.delete("/org/reporting-relationships/<int:rid>")
@roles_required("admin")
def delete_reporting_relationship(rid):
    db = get_db()
    try:
        row = db.execute("SELECT * FROM reporting_relationships WHERE id=?", (rid,)).fetchone()
        if not row:
            return jsonify({"error": "Not found"}), 404
        db.execute("DELETE FROM reporting_relationships WHERE id=?", (rid,))
        if row["relationship_type"] == "primary":
            other = db.execute(
                "SELECT COUNT(*) c FROM reporting_relationships WHERE employee_id=? "
                "AND relationship_type='primary' AND is_active=1",
                (row["employee_id"],)).fetchone()["c"]
            if other == 0:
                db.execute("UPDATE employees SET manager_id=NULL WHERE id=?", (row["employee_id"],))
        
        _log(db, "reporting_relationship", rid, "delete", old_value=row_to_dict(row))
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Chain of command
# ---------------------------------------------------------------------------

@bp.get("/org/chain/<int:employee_id>")
@login_required
def org_chain(employee_id):
    if not can_view_employee(g.user, employee_id):
        return jsonify({"error": "Forbidden"}), 403
    return jsonify(resolve_chain(employee_id))


@bp.get("/org/direct-reports/<int:employee_id>")
@login_required
def org_direct_reports(employee_id):
    if not can_view_employee(g.user, employee_id):
        return jsonify({"error": "Forbidden"}), 403
    return jsonify(direct_reports(employee_id))


@bp.get("/org/people-tree")
@login_required
def org_people_tree():
    """Nested reporting tree: executives at the top, then dept heads, then
    team leaders, then individual employees. Each person sits under their
    active primary supervisor (falling back to employees.manager_id)."""
    db = get_db()
    try:
        rows = db.execute(
            "SELECT e.id, e.full_name, e.position, e.job_grade, e.employment_status, "
            "d.name AS unit_name, d.id AS unit_id, "
            "p.title AS position_title, p.is_head, "
            "e.manager_id "
            "FROM employees e "
            "LEFT JOIN departments d ON d.id = e.department_id "
            "LEFT JOIN positions p ON p.id = e.position_id "
            "WHERE e.employment_status = 'active' OR e.employment_status IS NULL"
        ).fetchall()
        employees = rows_to_list(rows)

        # Resolve each person's supervisor from the active primary relationship,
        # falling back to the denormalized manager_id column.
        sup_ids = {}
        today = date.today().isoformat()
        rels = db.execute(
            "SELECT employee_id, supervisor_id FROM reporting_relationships "
            "WHERE relationship_type = 'primary' AND is_active = 1 "
            "AND (end_date IS NULL OR end_date = '' OR end_date >= ?)",
            (today,),
        ).fetchall()
        for r in rels:
            if r["employee_id"] != r["supervisor_id"]:
                sup_ids[r["employee_id"]] = r["supervisor_id"]
        for e in employees:
            if e["id"] not in sup_ids and e["manager_id"] and e["manager_id"] != e["id"]:
                sup_ids[e["id"]] = e["manager_id"]

        by_id = {e["id"]: {**e, "children": []} for e in employees}
        for eid, node in by_id.items():
            sup = sup_ids.get(eid)
            if sup and sup in by_id and sup != eid:
                by_id[sup]["children"].append(node)
        roots = [node for eid, node in by_id.items() if sup_ids.get(eid) not in by_id]
        if not roots:
            roots = list(by_id.values())

        for node in by_id.values():
            node["children"].sort(key=lambda c: c["full_name"])
        return jsonify(roots)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Transfers / reorgs (writes employee_org_history)
# ---------------------------------------------------------------------------

@bp.post("/employees/<int:employee_id>/transfer")
@roles_required("admin")
def transfer_employee(employee_id):
    data = request.get_json(force=True) or {}
    db = get_db()
    try:
        emp = db.execute("SELECT * FROM employees WHERE id=?", (employee_id,)).fetchone()
        if not emp:
            return jsonify({"error": "Not found"}), 404
        old = row_to_dict(emp)

        updates = {}
        if "department_id" in data:
            updates["department_id"] = data["department_id"]
        if "position_id" in data:
            updates["position_id"] = data["position_id"]
        if updates:
            set_clause = ", ".join(f"{k}=?" for k in updates)
            db.execute(f"UPDATE employees SET {set_clause} WHERE id=?", (*updates.values(), employee_id))

        # Auto-repoint the primary reporting relationship when a manager is supplied.
        manager_id = data.get("manager_id")
        if manager_id is not None:
            if manager_id and manager_id != employee_id:
                db.execute(
                    "UPDATE reporting_relationships SET is_active=0 "
                    "WHERE employee_id=? AND relationship_type='primary' AND is_active=1",
                    (employee_id,),
                )
                db.execute(
                    "INSERT INTO reporting_relationships (employee_id, supervisor_id, relationship_type, "
                    "start_date, reason, is_active) VALUES (?,?,?,?,?,1)",
                    (employee_id, manager_id, "primary", data.get("effective_date") or date.today().isoformat(),
                     data.get("reason") or "Transfer"),
                )
            else:
                manager_id = None
            db.execute("UPDATE employees SET manager_id=? WHERE id=?", (manager_id, employee_id))

        effective = data.get("effective_date") or date.today().isoformat()
        db.execute(
            "INSERT INTO employee_org_history (employee_id, org_unit_id, position_id, effective_date, "
            "reason, changed_by) VALUES (?,?,?,?,?,?)",
            (employee_id, updates.get("department_id", emp["department_id"]),
             updates.get("position_id", emp["position_id"]), effective,
             data.get("reason") or "Transfer", g.user.get("employee_id")),
        )
        db.commit()
        new = row_to_dict(db.execute("SELECT * FROM employees WHERE id=?", (employee_id,)).fetchone())
        _log(db, "employee", employee_id, "transfer", old_value=old, new_value=new)
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()

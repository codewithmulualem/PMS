from flask import Blueprint, request, jsonify, g

from database import get_db, row_to_dict
from auth import (
    verify_password,
    hash_password,
    issue_token,
    login_required,
    login_blocked,
    register_login_failure,
    reset_login_failures,
)

bp = Blueprint("auth_routes", __name__, url_prefix="/api/auth")


@bp.post("/login")
def login():
    data = request.get_json(force=True) or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")
    if not username or not password:
        return jsonify({"error": "username and password required"}), 400

    ip = request.remote_addr or "unknown"
    blocked = login_blocked(ip, username)
    if blocked:
        return jsonify({"error": blocked}), 429

    db = get_db()
    try:
        user = row_to_dict(db.execute(
            "SELECT u.*, r.name AS role_name FROM users u "
            "LEFT JOIN roles r ON r.id = u.role_id WHERE u.username = ?",
            (username,),
        ).fetchone())
        if not user or not verify_password(password, user["password_hash"]):
            register_login_failure(ip, username)
            return jsonify({"error": "Invalid credentials"}), 401
        # The roles table is the single source of truth for authorization;
        # the legacy users.role column is only a display/back-compat fallback
        # for rows that predate the roles table.
        if user.get("role_name"):
            user["role"] = user["role_name"]
        reset_login_failures(ip, username)
        token = issue_token(user)
        employee = None
        if user["employee_id"]:
            employee = db.execute(
                "SELECT id, full_name, position, department_id FROM employees WHERE id = ?",
                (user["employee_id"],),
            ).fetchone()
        return jsonify({
            "token": token,
            "user": {
                "id": user["id"],
                "username": user["username"],
                "role": user["role"],
                "employee_id": user["employee_id"],
                "employee": dict(employee) if employee else None,
            },
        })
    finally:
        db.close()


@bp.get("/me")
@login_required
def me():
    db = get_db()
    try:
        user = row_to_dict(db.execute(
            "SELECT u.*, r.name AS role_name FROM users u "
            "LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?",
            (g.user.get("sub"),),
        ).fetchone())
        if not user:
            return jsonify({"error": "User not found"}), 404
        if user.get("role_name"):
            user["role"] = user["role_name"]
        employee = None
        if user["employee_id"]:
            employee = db.execute(
                "SELECT id, full_name, position, department_id FROM employees WHERE id = ?",
                (user["employee_id"],),
            ).fetchone()
        return jsonify({
            "id": user["id"],
            "sub": user["id"],
            "username": user["username"],
            "role": user["role"],
            "employee_id": user["employee_id"],
            "employee": dict(employee) if employee else None,
        })
    finally:
        db.close()


@bp.post("/change-password")
@login_required
def change_password():
    """Self-service password change for any logged-in user."""
    data = request.get_json(force=True) or {}
    current = data.get("current_password", "")
    new = data.get("new_password", "")
    if not current or not new:
        return jsonify({"error": "current_password and new_password are required"}), 400
    if len(new) < 8:
        return jsonify({"error": "New password must be at least 8 characters"}), 400
    if new == current:
        return jsonify({"error": "New password must differ from the current one"}), 400

    db = get_db()
    try:
        user = row_to_dict(db.execute(
            "SELECT * FROM users WHERE id=?", (g.user.get("sub"),)).fetchone())
        if not user:
            return jsonify({"error": "Account not found"}), 404
        if not verify_password(current, user["password_hash"]):
            return jsonify({"error": "Current password is incorrect"}), 400
        db.execute("UPDATE users SET password_hash=? WHERE id=?",
                   (hash_password(new), user["id"]))
        db.execute(
            "INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value, changed_by) "
            "VALUES ('user', ?, 'change_password', ?, ?, ?)",
            (user["id"], "password changed", "password changed", g.user.get("username", "system")),
        )
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()

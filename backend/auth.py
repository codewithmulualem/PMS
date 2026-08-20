import hashlib
import hmac
import os
import time
from functools import wraps
from threading import Lock

import jwt
from flask import request, jsonify, g

from database import get_db

JWT_SECRET = os.environ.get("PMS_JWT_SECRET", "dev-secret-change-me-in-production")
if os.environ.get("PMS_ENV") == "production" and JWT_SECRET == "dev-secret-change-me-in-production":
    raise RuntimeError("PMS_JWT_SECRET must be set when PMS_ENV=production")
JWT_ALGO = "HS256"
TOKEN_TTL_SECONDS = 8 * 3600

# ---------------------------------------------------------------------------
# Login rate limiting (in-memory, dependency-free). Per-IP failures and
# per-username failures share one sliding window; hitting either limit locks
# that key out for a cooldown. A successful login resets both keys.
# ---------------------------------------------------------------------------
LOGIN_RATE_LIMIT_WINDOW = 15 * 60
LOGIN_MAX_IP_FAILURES = 5
LOGIN_MAX_USER_FAILURES = 10
LOGIN_LOCKOUT_SECONDS = 15 * 60

_login_state = {}
_login_state_lock = Lock()


def login_blocked(ip, username):
    """Returns an error message if `ip`/`username` is currently locked out, else None."""
    now = time.time()
    with _login_state_lock:
        for key in (f"ip:{ip}", f"user:{username}"):
            entry = _login_state.get(key)
            if entry and entry.get("locked_until", 0) > now:
                remaining_min = int((entry["locked_until"] - now) // 60) + 1
                return (
                    f"Too many failed login attempts. "
                    f"Try again in {remaining_min} minute(s)."
                )
            if entry and now - entry.get("window_start", now) > LOGIN_RATE_LIMIT_WINDOW:
                del _login_state[key]
    return None


def register_login_failure(ip, username):
    now = time.time()
    with _login_state_lock:
        for key, limit in (
            (f"ip:{ip}", LOGIN_MAX_IP_FAILURES),
            (f"user:{username}", LOGIN_MAX_USER_FAILURES),
        ):
            entry = _login_state.get(key)
            if entry and now - entry.get("window_start", now) > LOGIN_RATE_LIMIT_WINDOW:
                entry = {"count": 0, "window_start": now, "locked_until": 0}
            entry = entry or {"count": 0, "window_start": now, "locked_until": 0}
            entry["count"] += 1
            if entry["count"] >= limit:
                entry["locked_until"] = now + LOGIN_LOCKOUT_SECONDS
            _login_state[key] = entry


def reset_login_failures(ip, username):
    with _login_state_lock:
        _login_state.pop(f"ip:{ip}", None)
        _login_state.pop(f"user:{username}", None)


def hash_password(password: str, salt: str = None) -> str:
    salt = salt or os.urandom(16).hex()
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 100_000)
    return f"{salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, digest_hex = stored.split("$")
    except ValueError:
        return False
    check = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 100_000)
    return hmac.compare_digest(check.hex(), digest_hex)


def issue_token(user_row) -> str:
    payload = {
        "sub": user_row["id"],
        "username": user_row["username"],
        "role": user_row["role"],
        "employee_id": user_row["employee_id"],
        "exp": int(time.time()) + TOKEN_TTL_SECONDS,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def decode_token(token: str):
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Missing or invalid Authorization header"}), 401
        token = auth_header.split(" ", 1)[1]
        try:
            payload = decode_token(token)
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Token expired"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error": "Invalid token"}), 401
        g.user = payload
        return fn(*args, **kwargs)

    return wrapper


def roles_required(*allowed_roles):
    def decorator(fn):
        @wraps(fn)
        @login_required
        def wrapper(*args, **kwargs):
            if g.user["role"] not in allowed_roles:
                return jsonify({"error": "Forbidden: insufficient role"}), 403
            return fn(*args, **kwargs)

        return wrapper

    return decorator


READ_ROLES = ("admin", "executive")


def is_manager_of(db, manager_employee_id, target_employee_id) -> bool:
    """Direct-report check (one level). Used for scoping manager access."""
    if manager_employee_id is None:
        return False
    row = db.execute(
        "SELECT manager_id FROM employees WHERE id = ?", (target_employee_id,)
    ).fetchone()
    return bool(row and row["manager_id"] == manager_employee_id)


def can_view_employee(g_user, target_employee_id: int, db=None) -> bool:
    """RBAC check: admins/executives see everyone, managers see their direct
    reports + self, employees see only themselves.

    Pass an already-open connection via `db` when one is available to avoid
    opening a second SQLite connection mid-request."""
    if g_user["role"] in READ_ROLES:
        return True
    if g_user["employee_id"] == target_employee_id:
        return True
    if g_user["role"] == "manager":
        if db is not None:
            return is_manager_of(db, g_user["employee_id"], target_employee_id)
        conn = get_db()
        try:
            return is_manager_of(conn, g_user["employee_id"], target_employee_id)
        finally:
            conn.close()
    return False

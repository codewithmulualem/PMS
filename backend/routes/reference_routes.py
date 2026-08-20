"""Reference data endpoints — the single source of truth for dropdowns,
lookups, and per-role navigation, all backed by the database instead of
hardcoded values in the frontend."""

from flask import Blueprint, jsonify, g

from database import get_db, rows_to_list
from auth import login_required, roles_required

bp = Blueprint("reference_routes", __name__, url_prefix="/api")


@bp.get("/reference/rating-bands")
@login_required
def rating_bands():
    """Rating-band labels/colors used by distribution charts and badges."""
    db = get_db()
    try:
        rows = rows_to_list(db.execute(
            "SELECT label, color, min_score, max_score FROM rating_bands ORDER BY min_score DESC").fetchall())
        return jsonify(rows)
    finally:
        db.close()


@bp.get("/reference/competency-categories")
@login_required
def competency_categories():
    """Competency framework categories (ordered by sort_order)."""
    db = get_db()
    try:
        rows = rows_to_list(db.execute(
            "SELECT code, label FROM competency_categories ORDER BY sort_order, id").fetchall())
        return jsonify(rows)
    finally:
        db.close()


@bp.get("/reference/relationship-types")
@login_required
def relationship_types():
    """Valid reporting-relationship types for the org chart editor."""
    db = get_db()
    try:
        rows = rows_to_list(db.execute(
            "SELECT code, label FROM relationship_types ORDER BY sort_order, id").fetchall())
        return jsonify(rows)
    finally:
        db.close()


@bp.get("/reference/demo-accounts")
@roles_required("admin")
def demo_accounts():
    """Quick-fill credentials for admins (passwords omitted for security)."""
    db = get_db()
    try:
        rows = rows_to_list(db.execute(
            "SELECT username, role, note FROM demo_accounts ORDER BY sort_order, id").fetchall())
        return jsonify(rows)
    finally:
        db.close()


@bp.get("/reference/roles")
@roles_required("admin", "executive")
def assignable_roles():
    """Every assignable account role, straight from the roles table (keeps the
    admin account-management UI in sync with the DB instead of a hardcoded list)."""
    db = get_db()
    try:
        rows = rows_to_list(db.execute(
            "SELECT name FROM roles ORDER BY name").fetchall())
        return jsonify([r["name"] for r in rows])
    finally:
        db.close()


@bp.get("/me/navigation")
@login_required
def my_navigation():
    """The sidebar menu for the current user's role, from the DB."""
    db = get_db()
    try:
        rows = rows_to_list(db.execute(
            "SELECT item_key, label, icon FROM navigation_items "
            "WHERE role=? ORDER BY sort_order, id", (g.user["role"],)).fetchall())
        return jsonify(rows)
    finally:
        db.close()

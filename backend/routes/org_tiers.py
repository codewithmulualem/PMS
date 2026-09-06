"""Tier helpers for the hierarchical plan-performance feature.

Tiers are derived from the org tree (departments.parent_id + org_unit_types):
  executive   -> level 0 (Authority)
  director    -> level 1 (Directorate)
  dept_head   -> level 2 (Department)
  team_leader -> level 3 (Team)
Leaders see and manage only their org subtree.
"""

from database import get_db


def employee_unit(db, employee_id):
    """The org unit a leader belongs to, with its level."""
    row = db.execute(
        "SELECT d.id, d.name, d.unit_type_id, out.name AS type_name, out.level_order "
        "FROM employees e "
        "JOIN departments d ON d.id = e.department_id "
        "LEFT JOIN org_unit_types out ON out.id = d.unit_type_id "
        "WHERE e.id = ?",
        (employee_id,),
    ).fetchone()
    return row


def subtree_unit_ids(db, unit_id):
    """All descendant unit ids (including `unit_id` itself)."""
    rows = db.execute(
        "WITH RECURSIVE subtree(id) AS ("
        "  SELECT ? "
        "  UNION "
        "  SELECT d.id FROM departments d JOIN subtree s ON d.parent_id = s.id "
        ") SELECT id FROM subtree",
        (unit_id,),
    ).fetchall()
    return [r["id"] for r in rows]


def employees_in_units(db, unit_ids):
    """All active employees whose department is in unit_ids."""
    if not unit_ids:
        return []
    marks = ",".join("?" * len(unit_ids))
    return [dict(r) for r in db.execute(
        f"SELECT id, full_name, department_id, position, manager_id "
        f"FROM employees WHERE employment_status='active' AND department_id IN ({marks})",
        (*unit_ids,),
    ).fetchall()]  # noqa: E999


def team_members(db, team_unit_id):
    """Employees in a single team unit (used by team leaders)."""
    return employees_in_units(db, [team_unit_id])

"""Chain-of-command resolution engine.

Builds the reporting chain on top of the active 'primary' reporting
relationship, falling back to the denormalized `employees.manager_id` column
when no active primary relationship exists. Every walk is cycle-safe and
bounded by depth.

This is the primitive the approval workflow engine (Phase 2) uses to route
submissions: `resolve_chain()` gives the ordered approvers for an employee,
`unit_head()` resolves the occupant of a unit's head position.
"""

from datetime import date

from database import get_db, rows_to_list


def _active_relationship_clause():
    today = date.today().isoformat()
    return ("is_active = 1 AND (end_date IS NULL OR end_date = '' OR end_date >= ?)"), today


def _supervisor_id(db, employee_id, relationship_type):
    clause, today = _active_relationship_clause()
    row = db.execute(
        f"SELECT supervisor_id FROM reporting_relationships "
        f"WHERE employee_id = ? AND relationship_type = ? AND {clause} "
        f"ORDER BY id DESC LIMIT 1",
        (employee_id, relationship_type, today),
    ).fetchone()
    if row and row["supervisor_id"]:
        return row["supervisor_id"]
    return None


def resolve_chain(employee_id, relationship_type="primary", max_depth=20):
    """Ordered list of supervisors above `employee_id` (deepest first).

    The returned chain lists the employee's supervisor first, then that
    supervisor's supervisor, up the hierarchy. The employee themselves is not
    included. Falls back to `employees.manager_id` when a relationship row is
    missing."""
    db = get_db()
    try:
        chain = []
        seen = set()
        current = employee_id
        depth = 0
        while current is not None and depth < max_depth:
            if current in seen:
                break
            seen.add(current)
            row = db.execute(
                "SELECT e.id, e.full_name, e.position, e.job_grade, "
                "d.name AS department_name FROM employees e "
                "LEFT JOIN departments d ON d.id = e.department_id WHERE e.id = ?",
                (current,),
            ).fetchone()
            if not row:
                break
            if depth > 0:
                chain.append({**dict(row), "depth": depth})
            supervisor = _supervisor_id(db, current, relationship_type)
            if supervisor is None:
                fallback = db.execute(
                    "SELECT manager_id FROM employees WHERE id = ?", (current,)
                ).fetchone()
                supervisor = fallback["manager_id"] if fallback else None
            current = supervisor
            depth += 1
        return chain
    finally:
        db.close()


def direct_reports(employee_id, relationship_type="primary"):
    """Employees who actively report to `employee_id`."""
    db = get_db()
    try:
        clause, today = _active_relationship_clause()
        rows = db.execute(
            "SELECT e.id, e.full_name, e.position, e.job_grade, "
            "d.name AS department_name FROM reporting_relationships r "
            "JOIN employees e ON e.id = r.employee_id "
            "LEFT JOIN departments d ON d.id = e.department_id "
            f"WHERE r.supervisor_id = ? AND r.relationship_type = ? AND {clause} "
            "ORDER BY e.full_name",
            (employee_id, relationship_type, today),
        ).fetchall()
        return rows_to_list(rows)
    finally:
        db.close()


def unit_head(org_unit_id, db=None):
    """The employee occupying the unit's is_head position, if any.

    Pass an already-open connection via `db` to avoid a new SQLite connection
    per unit when building a whole tree."""
    own_conn = db is None
    db = db or get_db()
    try:
        row = db.execute(
            "SELECT e.id, e.full_name, e.position, p.title AS position_title, "
            "p.job_grade FROM positions p "
            "JOIN employees e ON e.position_id = p.id "
            "WHERE p.org_unit_id = ? AND p.is_head = 1 AND p.active = 1 "
            "AND e.employment_status = 'active' LIMIT 1",
            (org_unit_id,),
        ).fetchone()
        return dict(row) if row else None
    finally:
        if own_conn:
            db.close()


def is_unit_descendant(db, candidate_unit_id, ancestor_unit_id):
    """True if `candidate_unit_id` equals `ancestor_unit_id` or sits somewhere
    below it in the tree. Guards against creating cycles when reparenting."""
    current = candidate_unit_id
    seen = set()
    while current is not None:
        if current == ancestor_unit_id:
            return True
        if current in seen:
            return False
        seen.add(current)
        row = db.execute(
            "SELECT parent_id FROM departments WHERE id = ?", (current,)
        ).fetchone()
        current = row["parent_id"] if row else None
    return False

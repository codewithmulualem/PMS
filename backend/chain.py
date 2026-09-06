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


# ---------------------------------------------------------------------------
# Role-aware (tiered) approval chain
# ---------------------------------------------------------------------------
# A subject's chain climbs the org tree level by level and hands each step to
# the *head* of the corresponding org unit:
#   team member  -> team leader (L1) then department head (L2)   [depth 2]
#   team leader  -> department head                               [depth 1]
#   dept head    -> director                                      [depth 1]
#   director     -> executive                                     [depth 1]
#   executive    -> (none; auto-scored)                           [depth 0]
# This replaces the purely-structural walk for evaluation approvals so that
# reviews stay "within teams, signed off by the team lead then dept head".


def _subject_role_name(db, employee_id):
    """The subject's account role name (from the roles table), or None."""
    row = db.execute(
        "SELECT r.name FROM users u JOIN roles r ON r.id = u.role_id "
        "WHERE u.employee_id = ?", (employee_id,)
    ).fetchone()
    if row and row["name"]:
        return row["name"]
    # legacy fallback (users.role column)
    row = db.execute(
        "SELECT role FROM users WHERE employee_id = ?", (employee_id,)
    ).fetchone()
    return row["role"] if row else None


def _unit_chain_up(db, employee_id):
    """Ordered list of org units (their ids) from the subject's own unit up to
    the root, deepest first (cycle-safe)."""
    units = []
    seen = set()
    cur = db.execute(
        "SELECT department_id FROM employees WHERE id = ?", (employee_id,)
    ).fetchone()
    cur = cur["department_id"] if cur else None
    while cur is not None and cur not in seen:
        seen.add(cur)
        units.append(cur)
        row = db.execute("SELECT parent_id FROM departments WHERE id = ?", (cur,)).fetchone()
        cur = row["parent_id"] if row else None
    return units


def _unit_level_order(db, unit_id):
    if not unit_id:
        return None
    row = db.execute(
        "SELECT out.level_order FROM departments d "
        "LEFT JOIN org_unit_types out ON out.id = d.unit_type_id "
        "WHERE d.id = ?", (unit_id,)
    ).fetchone()
    return row["level_order"] if row else None


def _parent_of(db, unit_id):
    if not unit_id:
        return None
    row = db.execute("SELECT parent_id FROM departments WHERE id = ?", (unit_id,)).fetchone()
    return row["parent_id"] if row else None


def _subject_heads_own_unit(db, employee_id, unit_id):
    """True when `employee_id` occupies the is_head position of `unit_id`."""
    if not unit_id:
        return False
    row = db.execute(
        "SELECT 1 FROM positions p JOIN employees e ON e.position_id = p.id "
        "WHERE p.org_unit_id = ? AND p.is_head = 1 AND e.id = ? AND p.active = 1 "
        "AND e.employment_status = 'active'",
        (unit_id, employee_id),
    ).fetchone()
    return row is not None


def _is_valid_approver(db, head_id):
    """A legit approval node is a real supervisor, not a support-staff occupant
    of an is_head position (e.g. a secretary 'heading' the executive office).

    A head is valid if they carry a supervisor role, or hold a leadership
    position title. Support titles (Secretary/Officer/Specialist/Analyst)
    without a supervisor role are treated as non-approvers so the walk climbs
    past them to the executive who actually signs off."""
    row = db.execute(
        "SELECT p.title AS pos_title FROM employees e JOIN positions p ON p.id = e.position_id "
        "WHERE e.id = ?", (head_id,)
    ).fetchone()
    title = (row["pos_title"] or "") if row else ""
    role = _subject_role_name(db, head_id)
    if role in ("executive", "director", "dept_head", "team_leader", "manager", "admin"):
        return True
    lowered = title.lower()
    if any(k in lowered for k in (
        "director", "team leader", "director general", "head",
        "deputy", "general manager", "chief",
    )):
        return True
    return False


def resolve_tier_chain(employee_id, db=None):
    """An ordered list of approver ids (deepest first) for `employee_id`,
    resolved by org-unit heads and capped by the subject's apparent tier.

      team member  -> team leader then department head   [depth 2]
      team leader  -> department head                    [depth 1]
      dept head    -> director                           [depth 1]
      director     -> executive                          [depth 1]
      executive    -> []                                 [depth 0]

    Support-staff occupants of unit-head positions (secretaries, etc.) are
    skipped so the approval resolves to the real signing supervisor above.

    Returns [] for apex/executive subjects (auto-scored on submission)."""
    own_conn = db is None
    db = db or get_db()
    try:
        role = _subject_role_name(db, employee_id)
        units = _unit_chain_up(db, employee_id)
        own_unit = units[0] if units else None
        own_level = _unit_level_order(db, own_unit)

        # Depth cap based on the subject's position in the hierarchy.
        if role in ("dept_head", "director"):
            depth = 1
        elif own_level == 3:
            # A team leader (even without an account) heads their own team -> 1
            # further level; a plain team member -> team leader then dept head.
            depth = 1 if _subject_heads_own_unit(db, employee_id, own_unit) else 2
        elif own_level in (1, 2):
            depth = 1
        else:
            depth = 0  # authority / apex / unknown

        if depth <= 0:
            return []

        heads = []
        for unit in units:
            if len(heads) >= depth:
                break
            head = unit_head(unit, db=db)
            if head and head["id"] != employee_id and _is_valid_approver(db, head["id"]):
                heads.append(head["id"])
        return heads
    finally:
        if own_conn:
            db.close()

"""Role-aware, level-scoped evaluation approval chain.

The chain for a subject is resolved by walking the org tree upward and
handing each step to the *head* of the corresponding unit:

  team member -> team leader then department head (depth 2)
  team leader -> department head / next-up         (depth 1)
  dept head   -> director                          (depth 1)
  director    -> executive                          (depth 1)
  executive   -> []  (auto-scored)

Support-staff occupants of unit-head positions (secretaries) are skipped so
approval resolves to the real signing supervisor above.
"""

import sqlite3

import chain
import database


def _build_tiered_org():
    db = database.get_db()
    db.row_factory = sqlite3.Row
    db.executescript("""
        INSERT INTO org_unit_types (id, name, level_order) VALUES
            (1, 'Authority', 0), (2, 'Directorate', 1),
            (3, 'Department', 2), (4, 'Team', 3);

        INSERT INTO departments (id, name, unit_type_id, parent_id) VALUES
            (10, 'Authority Root', 1, NULL),
            (11, 'Directorate',    2, 10),
            (12, 'Department',     3, 11),
            (13, 'Team',           4, 12);

        INSERT INTO positions (id, title, org_unit_id, is_head) VALUES
            (100, 'Director General', 10, 1),
            (101, 'Director',         11, 1),
            (102, 'Dept Head',        12, 1),
            (103, 'Team Leader',      13, 1),
            (104, 'Officer',          13, 0),
            (105, 'Secretary',        10, 0);

        INSERT INTO employees (id, full_name, email, position, position_id, department_id, manager_id, employment_status)
        VALUES
            (21, 'Exec',      'exec@t.com',   'Director General', 100, 10, NULL, 'active'),
            (22, 'Director',  'dir@t.com',    'Director',         101, 11, 21,   'active'),
            (23, 'DeptHead',  'dh@t.com',     'Dept Head',        102, 12, 22,   'active'),
            (24, 'TeamLead',  'tl@t.com',     'Team Leader',      103, 13, 23,   'active'),
            (25, 'Member',    'member@t.com', 'Officer',          104, 13, 24,   'active'),
            (26, 'Secretary', 'sec@t.com',    'Secretary',        105, 10, 21,   'active');
    """)
    db.execute(
        "INSERT INTO reporting_relationships "
        "(employee_id, supervisor_id, relationship_type, is_active) VALUES "
        "(22,21,'primary',1),(23,22,'primary',1),(24,23,'primary',1),"
        "(25,24,'primary',1),(26,21,'primary',1)"
    )
    db.execute(
        "INSERT INTO roles (id, name, system_default) VALUES "
        "(10,'director',1),(11,'dept_head',1),(12,'team_leader',1)"
    )
    db.execute(
        "INSERT INTO users (username, password_hash, role, employee_id) VALUES "
        "('usr_dir','x','director',22),('usr_dh','x','dept_head',23),"
        "('usr_tl','x','team_leader',24),('usr_mem','x','employee',25)"
    )
    db.commit()
    db.close()


def _chain(sqlite_conn_or_none, eid):
    # resolve_tier_chain opens its own connection to the same DB file
    return chain.resolve_tier_chain(eid)


def _names(ids):
    db = database.get_db()
    out = [db.execute("SELECT full_name FROM employees WHERE id=?", (i,)).fetchone()["full_name"]
           for i in ids]
    db.close()
    return out


def test_member_chain_team_lead_then_dept_head():
    _build_tiered_org()
    ch = _chain(None, 25)
    assert _names(ch) == ["TeamLead", "DeptHead"]


def test_team_lead_chain_one_step():
    _build_tiered_org()
    ch = _chain(None, 24)
    assert _names(ch) == ["DeptHead"]


def test_dept_head_chain_to_director():
    _build_tiered_org()
    ch = _chain(None, 23)
    assert _names(ch) == ["Director"]


def test_director_chain_to_executive():
    _build_tiered_org()
    ch = _chain(None, 22)
    assert _names(ch) == ["Exec"]


def test_executive_chain_empty_auto_score():
    _build_tiered_org()
    assert _chain(None, 21) == []


def test_support_secretary_head_skipped():
    """A unit-head occupant with a support title and no supervisor role is not a
    valid approver; the walk climbs past them to the real supervisor above."""
    _build_tiered_org()
    db = database.get_db()
    # employee 26 = "Secretary", no user account, occupies is_head position 105
    assert chain._is_valid_approver(db, 26) is False
    # employee 22 = "Director" with a director role -> valid
    assert chain._is_valid_approver(db, 22) is True
    # a team leader role holder is valid even without a director title
    assert chain._is_valid_approver(db, 24) is True
    db.close()

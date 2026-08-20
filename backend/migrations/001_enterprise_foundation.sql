-- 001_enterprise_foundation.sql
-- Phase 0: configurable org hierarchy (level types, positions, reporting
-- relationships, org history), RBAC (roles/permissions), a generic approval
-- workflow engine (definitions/steps/requests/actions), delegation registry,
-- in-app notifications, and evaluation template versioning + acknowledgement.
-- Non-destructive: only adds tables and nullable columns.

-- --------------------------------------------------------------------------
-- Org hierarchy: configurable level types
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_unit_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    level_order INTEGER NOT NULL,
    system_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

ALTER TABLE departments ADD COLUMN unit_type_id INTEGER REFERENCES org_unit_types(id);
ALTER TABLE departments ADD COLUMN code TEXT;
ALTER TABLE departments ADD COLUMN active INTEGER DEFAULT 1;

-- Positions: a role within an org unit, occupied by zero or one employee.
CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    job_grade TEXT,
    org_unit_id INTEGER REFERENCES departments(id),
    is_head INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

ALTER TABLE employees ADD COLUMN position_id INTEGER REFERENCES positions(id);

-- Reporting relationships: richer than the single manager_id column.
-- The active 'primary' relationship is the chain-of-command backbone;
-- secondary/functional/administrative/acting/temporary cover matrix & temp roles.
CREATE TABLE IF NOT EXISTS reporting_relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    supervisor_id INTEGER NOT NULL REFERENCES employees(id),
    relationship_type TEXT NOT NULL DEFAULT 'primary'
        CHECK(relationship_type IN ('primary','secondary','functional','administrative','acting','temporary')),
    start_date TEXT,
    end_date TEXT,
    reason TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Historical record of org/position changes (transfers, reorgs, promotions).
CREATE TABLE IF NOT EXISTS employee_org_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    org_unit_id INTEGER REFERENCES departments(id),
    position_id INTEGER REFERENCES positions(id),
    effective_date TEXT,
    reason TEXT,
    changed_by INTEGER REFERENCES employees(id),
    created_at TEXT DEFAULT (datetime('now'))
);

-- --------------------------------------------------------------------------
-- RBAC: roles, permissions, and their mapping
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    system_default INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT,
    description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INTEGER NOT NULL REFERENCES roles(id),
    permission_id INTEGER NOT NULL REFERENCES permissions(id),
    PRIMARY KEY (role_id, permission_id)
);

ALTER TABLE users ADD COLUMN role_id INTEGER REFERENCES roles(id);

-- --------------------------------------------------------------------------
-- Generic approval workflow engine
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_definitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    description TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workflow_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_id INTEGER NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL,
    mode TEXT NOT NULL DEFAULT 'sequential'
        CHECK(mode IN ('sequential','parallel_all','parallel_any')),
    approver_type TEXT NOT NULL DEFAULT 'chain_level'
        CHECK(approver_type IN ('chain_level','role','specific_employee','unit_head','initiator_manager')),
    approver_value TEXT,           -- chain level number, role code, employee id, or org unit level
    condition TEXT,                -- JSON rule that gates whether this step runs
    sla_hours INTEGER,
    escalation_step_id INTEGER REFERENCES workflow_steps(id),
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS approval_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_id INTEGER REFERENCES workflow_definitions(id),
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    initiator_id INTEGER REFERENCES employees(id),
    status TEXT NOT NULL DEFAULT 'submitted'
        CHECK(status IN ('submitted','pending','approved','declined','returned','cancelled','escalated','delegated')),
    current_step_order INTEGER DEFAULT 1,
    submitted_at TEXT DEFAULT (datetime('now')),
    decided_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Immutable action log for every approval request.
CREATE TABLE IF NOT EXISTS approval_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
    step_id INTEGER REFERENCES workflow_steps(id),
    actor_id INTEGER REFERENCES employees(id),
    action TEXT NOT NULL
        CHECK(action IN ('submit','approve','decline','return','resubmit','cancel','escalate','delegate')),
    comments TEXT,
    from_status TEXT,
    to_status TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- --------------------------------------------------------------------------
-- Delegation registry
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delegations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delegator_id INTEGER NOT NULL REFERENCES employees(id),
    delegate_id INTEGER NOT NULL REFERENCES employees(id),
    start_date TEXT,
    end_date TEXT,
    scope TEXT,                    -- JSON describing which workflows/entities are covered
    reason TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

-- --------------------------------------------------------------------------
-- In-app notifications
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT,
    title TEXT NOT NULL,
    body TEXT,
    entity_type TEXT,
    entity_id INTEGER,
    read_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- --------------------------------------------------------------------------
-- Evaluation foundation: template versioning, question/assignment extensions,
-- acknowledgement
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evaluation_template_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    form_id INTEGER NOT NULL REFERENCES evaluation_forms(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    snapshot TEXT NOT NULL,        -- JSON snapshot of the form (sections + questions)
    created_by INTEGER REFERENCES employees(id),
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(form_id, version)
);

-- Conditional visibility: JSON rule that must evaluate true for the question to show.
ALTER TABLE evaluation_form_questions ADD COLUMN visibility_condition TEXT;
ALTER TABLE evaluation_form_questions ADD COLUMN evidence_required INTEGER DEFAULT 0;
ALTER TABLE evaluation_form_questions ADD COLUMN comment_required INTEGER DEFAULT 0;
-- JSON rule: require a comment when a specific answer applies (e.g. rating <= 2).
ALTER TABLE evaluation_form_questions ADD COLUMN comment_required_if TEXT;

ALTER TABLE evaluation_assignments ADD COLUMN approval_request_id INTEGER REFERENCES approval_requests(id);
ALTER TABLE evaluation_assignments ADD COLUMN acknowledged INTEGER DEFAULT 0;
ALTER TABLE evaluation_assignments ADD COLUMN acknowledged_at TEXT;
ALTER TABLE evaluation_assignments ADD COLUMN acknowledgement_comment TEXT;

CREATE TABLE IF NOT EXISTS evaluation_acknowledgements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER NOT NULL REFERENCES evaluation_assignments(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    agreed INTEGER DEFAULT 0,
    comment TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

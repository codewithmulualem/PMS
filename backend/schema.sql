CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES departments(id)
);

CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    position TEXT,
    job_grade TEXT,
    department_id INTEGER REFERENCES departments(id),
    manager_id INTEGER REFERENCES employees(id),
    employment_status TEXT DEFAULT 'active',
    date_joined TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','manager','employee','executive')),
    employee_id INTEGER REFERENCES employees(id),
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS performance_cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    status TEXT DEFAULT 'active' CHECK(status IN ('planned','active','closed'))
);

-- Configurable scoring weights, per cycle (falls back to global defaults if none set)
CREATE TABLE IF NOT EXISTS score_weights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cycle_id INTEGER REFERENCES performance_cycles(id),
    kpi_weight REAL DEFAULT 40,
    goal_weight REAL DEFAULT 25,
    competency_weight REAL DEFAULT 15,
    behavior_weight REAL DEFAULT 10,
    project_weight REAL DEFAULT 10
);

CREATE TABLE IF NOT EXISTS rating_bands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    min_score REAL NOT NULL,
    max_score REAL NOT NULL,
    label TEXT NOT NULL,
    color TEXT DEFAULT '#888888'
);

CREATE TABLE IF NOT EXISTS kpis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER REFERENCES employees(id),
    cycle_id INTEGER REFERENCES performance_cycles(id),
    name TEXT NOT NULL,
    definition TEXT,
    measurement_unit TEXT,
    target_value REAL,
    min_acceptable_value REAL,
    stretch_value REAL,
    actual_value REAL,
    weight REAL DEFAULT 0,
    direction TEXT DEFAULT 'higher_is_better' CHECK(direction IN ('higher_is_better','lower_is_better','target_is_best')),
    frequency TEXT DEFAULT 'quarterly',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER REFERENCES employees(id),
    cycle_id INTEGER REFERENCES performance_cycles(id),
    kpi_id INTEGER REFERENCES kpis(id),
    title TEXT NOT NULL,
    description TEXT,
    baseline REAL,
    target_value REAL,
    actual_value REAL DEFAULT 0,
    measurement_unit TEXT,
    weight REAL DEFAULT 0,
    priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
    start_date TEXT,
    end_date TEXT,
    status TEXT DEFAULT 'in_progress' CHECK(status IN ('not_started','in_progress','completed','at_risk','cancelled')),
    evidence_note TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS competencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT CHECK(category IN ('technical','leadership','behavioral')),
    definition TEXT
);

CREATE TABLE IF NOT EXISTS employee_competencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER REFERENCES employees(id),
    competency_id INTEGER REFERENCES competencies(id),
    current_level REAL DEFAULT 0,   -- 0-5 scale
    target_level REAL DEFAULT 0,
    evidence_note TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(employee_id, competency_id)
);

CREATE TABLE IF NOT EXISTS evaluations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER REFERENCES employees(id),
    cycle_id INTEGER REFERENCES performance_cycles(id),
    evaluator_id INTEGER REFERENCES employees(id),
    evaluator_type TEXT CHECK(evaluator_type IN ('self','manager','peer','subordinate')),
    behavior_score REAL,           -- 0-100, rater-entered
    project_score REAL,            -- 0-100, rater-entered
    comments TEXT,
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft','submitted')),
    submitted_at TEXT
);

CREATE TABLE IF NOT EXISTS performance_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER REFERENCES employees(id),
    cycle_id INTEGER REFERENCES performance_cycles(id),
    kpi_score REAL,
    goal_score REAL,
    competency_score REAL,
    behavior_score REAL,
    project_score REAL,
    overall_score REAL,
    rating_label TEXT,
    calculated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(employee_id, cycle_id)
);

-- ---------------------------------------------------------------------------
-- Evaluation form workflow: template forms -> assignments -> answers -> approvals
-- Each assignment carries its own score, computed from the form's answers.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS evaluation_forms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    approval_levels INTEGER DEFAULT 2,   -- how many levels of the chain must approve
    active INTEGER DEFAULT 1,
    -- 360 support: each evaluator perspective carries its own weight; the
    -- subject's overall score renormalizes over the perspectives that exist.
    weight_self REAL DEFAULT 1,
    weight_manager REAL DEFAULT 1,
    weight_peer REAL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS evaluation_form_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    form_id INTEGER REFERENCES evaluation_forms(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    weight REAL DEFAULT 1,               -- weight of this section WITHIN its perspective
    perspective TEXT DEFAULT 'self' CHECK(perspective IN ('self','manager','peer')),
    order_index INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS evaluation_form_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER REFERENCES evaluation_form_sections(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    description TEXT,                    -- hint shown under the question
    kind TEXT DEFAULT 'rating' CHECK(kind IN ('rating','scale','text','select','multi')),
    max_score REAL,                      -- top of the scale (rating=5, scale=custom)
    options TEXT,                        -- JSON array of options for select/multi
    required INTEGER DEFAULT 0,
    order_index INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS evaluation_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    form_id INTEGER REFERENCES evaluation_forms(id),
    employee_id INTEGER REFERENCES employees(id),   -- the subject being evaluated
    cycle_id INTEGER REFERENCES performance_cycles(id),
    evaluator_type TEXT DEFAULT 'self' CHECK(evaluator_type IN ('self','manager','peer')),
    evaluator_id INTEGER REFERENCES employees(id),  -- who must fill this perspective
    due_date TEXT,
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft','submitted','in_review','rejected','scored')),
    current_level INTEGER DEFAULT 0,     -- levels approved so far
    score REAL,                          -- this perspective's own score, 0-100
    max_score REAL,                      -- denominator, 0-100 by construction
    overall_score REAL,                  -- combined 360 score for the subject (same for all its rows)
    submitted_at TEXT,
    finalized_at TEXT,
    UNIQUE(form_id, employee_id, cycle_id, evaluator_type, evaluator_id)
);

CREATE TABLE IF NOT EXISTS evaluation_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER REFERENCES evaluation_assignments(id) ON DELETE CASCADE,
    question_id INTEGER REFERENCES evaluation_form_questions(id) ON DELETE CASCADE,
    rating_value REAL,
    text_value TEXT,
    note TEXT,                           -- evaluator's own comment on their answer
    UNIQUE(assignment_id, question_id)
);

CREATE TABLE IF NOT EXISTS evaluation_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER REFERENCES evaluation_assignments(id) ON DELETE CASCADE,
    level INTEGER NOT NULL,
    approver_id INTEGER REFERENCES employees(id),
    decision TEXT CHECK(decision IN ('approved','rejected')),
    comments TEXT,
    decided_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER REFERENCES employees(id),
    cycle_id INTEGER REFERENCES performance_cycles(id),
    insight_type TEXT CHECK(insight_type IN ('summary','risk_flag','development','prediction','anomaly')),
    content TEXT NOT NULL,
    supporting_data TEXT,          -- JSON string describing what the insight is based on
    confidence REAL,               -- for predictions
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    action TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    changed_by TEXT,
    reason TEXT,
    timestamp TEXT DEFAULT (datetime('now'))
);

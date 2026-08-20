-- Automated Project & Task Evaluation Module
-- Projects are cycle-scoped; tasks are hierarchical (adjacency-list parent_id);
-- each task carries dynamic KPIs; progress is recorded against KPIs.

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    owner_id INTEGER REFERENCES employees(id),
    cycle_id INTEGER REFERENCES performance_cycles(id),
    start_date TEXT,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'planning'
        CHECK(status IN ('planning','active','completed','on_hold','cancelled')),
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES project_tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    assignee_id INTEGER REFERENCES employees(id),
    start_date TEXT,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'not_started'
        CHECK(status IN ('not_started','in_progress','completed','on_hold','cancelled')),
    progress_pct REAL DEFAULT 0,
    weight REAL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_kpis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kpi_type TEXT NOT NULL CHECK(kpi_type IN ('percentage','numeric','milestone')),
    target_value REAL,
    actual_value REAL,
    unit TEXT,
    weight REAL DEFAULT 1,
    direction TEXT NOT NULL DEFAULT 'higher_is_better'
        CHECK(direction IN ('higher_is_better','lower_is_better')),
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_progress_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
    recorded_by INTEGER REFERENCES employees(id),
    progress_pct REAL NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Migration 010: Fix projects.status CHECK to use 'in_progress' instead of 'active'.

CREATE TABLE projects_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    owner_id INTEGER REFERENCES employees(id),
    cycle_id INTEGER REFERENCES performance_cycles(id),
    start_date TEXT,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'planning'
        CHECK(status IN ('planning','in_progress','completed','on_hold','cancelled')),
    created_at TEXT DEFAULT (datetime('now')),
    weight REAL DEFAULT 1
);

INSERT INTO projects_new (id, name, description, owner_id, cycle_id, start_date, due_date,
    status, created_at, weight)
SELECT id, name, description, owner_id, cycle_id, start_date, due_date,
    CASE WHEN status='active' THEN 'in_progress' ELSE status END,
    created_at, weight
FROM projects;

DROP TABLE projects;
ALTER TABLE projects_new RENAME TO projects;

CREATE INDEX IF NOT EXISTS idx_projects_cycle ON projects(cycle_id);

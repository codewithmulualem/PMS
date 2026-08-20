-- Migration 009: Extend task_kpis direction constraint, add project weight.
--
-- Fixes:
--   1. direction CHECK now allows 'target_is_best' (was only higher/lower).
--   2. projects.weight column for inter-project weighting in roll-ups.

-- 1. Extend direction CHECK on task_kpis.
-- SQLite doesn't support ALTER CHECK, so rebuild the table.
CREATE TABLE task_kpis_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kpi_type TEXT NOT NULL CHECK (kpi_type IN ('percentage','numeric','milestone')),
    target_value REAL,
    actual_value REAL,
    unit TEXT,
    weight REAL DEFAULT 1,
    direction TEXT NOT NULL DEFAULT 'higher_is_better'
        CHECK (direction IN ('higher_is_better','lower_is_better','target_is_best')),
    created_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO task_kpis_new (id, task_id, name, kpi_type, target_value, actual_value, unit, weight, direction, created_at)
SELECT id, task_id, name, kpi_type, target_value, actual_value, unit, weight, direction, created_at
FROM task_kpis;

DROP TABLE task_kpis;
ALTER TABLE task_kpis_new RENAME TO task_kpis;

CREATE INDEX IF NOT EXISTS idx_task_kpis_task ON task_kpis(task_id);

-- 2. Add weight column to projects.
ALTER TABLE projects ADD COLUMN weight REAL DEFAULT 1;

-- Record migration.
INSERT INTO schema_migrations (version) VALUES ('009');

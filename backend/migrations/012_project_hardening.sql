-- Migration 012: Project hardening — created_by, sort_order, indexes, target_is_best fix
-- Applied automatically by seed.py in filename order.

-- 1. Add created_by to projects for audit trail
ALTER TABLE projects ADD COLUMN created_by INTEGER REFERENCES employees(id);

-- 2. Add sort_order to project_tasks for manual ordering
ALTER TABLE project_tasks ADD COLUMN sort_order INTEGER DEFAULT 0;

-- 3. Fix kpis.direction CHECK to include target_is_best (drop + recreate)
CREATE TABLE IF NOT EXISTS kpis_new (
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
INSERT INTO kpis_new SELECT * FROM kpis;
DROP TABLE kpis;
ALTER TABLE kpis_new RENAME TO kpis;

-- 4. Performance indexes
CREATE INDEX IF NOT EXISTS idx_kpis_employee_cycle ON kpis(employee_id, cycle_id);
CREATE INDEX IF NOT EXISTS idx_goals_employee_cycle ON goals(employee_id, cycle_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_evaluator ON evaluations(evaluator_id);
CREATE INDEX IF NOT EXISTS idx_performance_scores_employee ON performance_scores(employee_id, cycle_id);
CREATE INDEX IF NOT EXISTS idx_task_kpis_task ON task_kpis(task_id);
CREATE INDEX IF NOT EXISTS idx_task_progress_logs_task ON task_progress_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_parent ON project_tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_assignee ON project_tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_assignments_employee ON evaluation_assignments(employee_id, cycle_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);

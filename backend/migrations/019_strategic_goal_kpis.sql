-- Strategic-goal KPIs: every individual (member) task set by a team leader is
-- measured by at least one KPI. Mirrors activity_kpis so achievement can be
-- weighted and direction-aware.
CREATE TABLE IF NOT EXISTS strategic_goal_kpis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategic_goal_id INTEGER NOT NULL REFERENCES strategic_goals(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_strategic_goal_kpis_goal ON strategic_goal_kpis(strategic_goal_id);
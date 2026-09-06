-- Weekly Plans: simple to-do lists for employees
CREATE TABLE IF NOT EXISTS weekly_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    week_start TEXT NOT NULL,
    week_end TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(employee_id, week_start)
);

CREATE TABLE IF NOT EXISTS weekly_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'done')),
    strategic_goal_id INTEGER REFERENCES strategic_goals(id),
    created_at TEXT DEFAULT (datetime('now')),
    sort_order INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_weekly_plans_employee ON weekly_plans(employee_id);
CREATE INDEX IF NOT EXISTS idx_weekly_plans_week ON weekly_plans(week_start, week_end);
CREATE INDEX IF NOT EXISTS idx_weekly_tasks_plan ON weekly_tasks(plan_id);
CREATE INDEX IF NOT EXISTS idx_weekly_tasks_status ON weekly_tasks(status);

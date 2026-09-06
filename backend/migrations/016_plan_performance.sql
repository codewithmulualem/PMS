-- 016_plan_performance.sql
-- Daily follow-up support for weekly tasks:
--   * add an optional day-of-week marker (1=Mon .. 5=Fri) so employees can
--     assign each task to a day and track it daily
--   * widen the task status from a binary pending/done to a 3-state
--     (todo / in_progress / done) to support daily progress updates
PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS weekly_tasks_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT DEFAULT 'todo' CHECK(status IN ('todo', 'in_progress', 'done')),
    day_of_week INTEGER CHECK(day_of_week BETWEEN 1 AND 5),
    strategic_goal_id INTEGER REFERENCES strategic_goals(id),
    created_at TEXT DEFAULT (datetime('now')),
    sort_order INTEGER DEFAULT 0
);

INSERT INTO weekly_tasks_new (id, plan_id, title, status, day_of_week, strategic_goal_id, created_at, sort_order)
    SELECT id, plan_id, title,
           CASE WHEN status = 'done' THEN 'done' ELSE 'todo' END,
           NULL, strategic_goal_id, created_at, sort_order
    FROM weekly_tasks;

DROP TABLE weekly_tasks;
ALTER TABLE weekly_tasks_new RENAME TO weekly_tasks;

CREATE INDEX IF NOT EXISTS idx_weekly_tasks_plan ON weekly_tasks(plan_id);
CREATE INDEX IF NOT EXISTS idx_weekly_tasks_status ON weekly_tasks(status);
CREATE INDEX IF NOT EXISTS idx_weekly_tasks_day ON weekly_tasks(day_of_week);

PRAGMA foreign_keys=ON;

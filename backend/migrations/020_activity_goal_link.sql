-- Program activities are assessed against the plan & goal hierarchy: each
-- activity can serve the strategic goal (e.g. the dept-head's per-team
-- quarterly plan) it delivers toward. Goal progress blends weekly-task
-- completion with the KPI achievement of its linked activities.
ALTER TABLE program_activities ADD COLUMN strategic_goal_id INTEGER REFERENCES strategic_goals(id);
CREATE INDEX IF NOT EXISTS idx_program_activities_goal ON program_activities(strategic_goal_id);
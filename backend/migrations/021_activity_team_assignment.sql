-- Activities are set by departments and assigned to a team (org unit) — not to
-- a team-leader's person. assignee_id is kept for member-level drill-down only.
ALTER TABLE program_activities ADD COLUMN org_unit_id INTEGER REFERENCES departments(id);
CREATE INDEX IF NOT EXISTS idx_program_activities_org_unit ON program_activities(org_unit_id);
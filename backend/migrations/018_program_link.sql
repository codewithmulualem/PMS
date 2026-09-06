-- Grand plans are coined from programs: an annual (grand) strategic goal can be
-- created from a source program, and the linkage cascades down the goal tree.
ALTER TABLE strategic_goals ADD COLUMN program_id INTEGER REFERENCES programs(id);
CREATE INDEX IF NOT EXISTS idx_strategic_goals_program ON strategic_goals(program_id);
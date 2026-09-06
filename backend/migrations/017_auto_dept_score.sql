-- Auto dept-head score: marks an evaluation assignment whose score is computed
-- automatically from the department's weekly-plan task completion (assigned by a
-- director), rather than from a manually answered evaluation form.
--
--   NULL               -> normal manually-scored assignment
--   'department_plan'  -> auto-computed from the department's plan performance
ALTER TABLE evaluation_assignments ADD COLUMN auto_score_source TEXT;

CREATE INDEX IF NOT EXISTS idx_evaluation_assignments_auto
    ON evaluation_assignments(auto_score_source);

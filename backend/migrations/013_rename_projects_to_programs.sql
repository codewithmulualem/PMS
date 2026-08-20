-- Migration 013: Rename projects→programs, tasks→activities for EPA context.
--
-- Tables:   projects        → programs
--           project_tasks   → program_activities
--           task_kpis       → activity_kpis
--           task_progress_logs → activity_progress_logs
-- Columns:  project_id      → program_id
--           project_score   → program_score
--           project_weight  → program_weight
-- Triggers and indexes are dropped and recreated with new names.

-- 1. Drop triggers that reference old table/column names.
DROP TRIGGER IF EXISTS trg_no_cross_project_parent;
DROP TRIGGER IF EXISTS trg_no_cross_project_parent_upd;

-- 2. Drop indexes that reference old table/column names.
DROP INDEX IF EXISTS idx_task_kpis_task;
DROP INDEX IF EXISTS idx_task_progress_logs_task;
DROP INDEX IF EXISTS idx_project_tasks_project;
DROP INDEX IF EXISTS idx_project_tasks_parent;
DROP INDEX IF EXISTS idx_project_tasks_assignee;

-- 3. Rename tables.
ALTER TABLE projects RENAME TO programs;
ALTER TABLE project_tasks RENAME TO program_activities;
ALTER TABLE task_kpis RENAME TO activity_kpis;
ALTER TABLE task_progress_logs RENAME TO activity_progress_logs;

-- 4. Rename columns in program_activities.
ALTER TABLE program_activities RENAME COLUMN project_id TO program_id;

-- 5. Rename task_id columns in activity tables.
ALTER TABLE activity_kpis RENAME COLUMN task_id TO activity_id;
ALTER TABLE activity_progress_logs RENAME COLUMN task_id TO activity_id;

-- 6. Rename columns in score_weights.
ALTER TABLE score_weights RENAME COLUMN project_weight TO program_weight;

-- 6. Rename columns in evaluations.
ALTER TABLE evaluations RENAME COLUMN project_score TO program_score;

-- 7. Rename columns in performance_scores.
ALTER TABLE performance_scores RENAME COLUMN project_score TO program_score;

-- 8. Recreate cross-activity parent rejection trigger.
CREATE TRIGGER IF NOT EXISTS trg_no_cross_program_activity_parent
BEFORE INSERT ON program_activities
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'Activity must belong to the same program')
    WHERE NEW.parent_id IS NOT NULL
      AND EXISTS (
          SELECT 1 FROM program_activities p
          WHERE p.id = NEW.parent_id AND p.program_id != NEW.program_id
      );
    SELECT RAISE(ABORT, 'Activity cannot be its own parent')
    WHERE NEW.parent_id = NEW.id;
END;

CREATE TRIGGER trg_no_cross_program_activity_parent_upd
BEFORE UPDATE OF parent_id ON program_activities
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'Activity must belong to the same program')
    WHERE NEW.parent_id IS NOT NULL
      AND EXISTS (
          SELECT 1 FROM program_activities p
          WHERE p.id = NEW.parent_id AND p.program_id != NEW.program_id
      );
    SELECT RAISE(ABORT, 'Activity cannot be its own parent')
    WHERE NEW.parent_id = NEW.id;
END;

-- 9. Recreate indexes with new names.
CREATE INDEX IF NOT EXISTS idx_activity_kpis_activity ON activity_kpis(activity_id);
CREATE INDEX IF NOT EXISTS idx_activity_progress_logs_activity ON activity_progress_logs(activity_id);
CREATE INDEX IF NOT EXISTS idx_program_activities_program ON program_activities(program_id);
CREATE INDEX IF NOT EXISTS idx_program_activities_parent ON program_activities(parent_id);
CREATE INDEX IF NOT EXISTS idx_program_activities_assignee ON program_activities(assignee_id);
CREATE INDEX IF NOT EXISTS idx_programs_cycle ON programs(cycle_id);

INSERT INTO schema_migrations (version) VALUES ('013');

-- Migration 011: Strict hierarchy enforcement for project tasks.
--
-- 1. Cross-project parent rejection trigger (defense in depth).
-- 2. Self-reference prevention trigger.
-- 3. assigned_by column for delegation chain tracking.

-- 1. Prevent a task from being parented under a different project's task.
CREATE TRIGGER IF NOT EXISTS trg_no_cross_project_parent
BEFORE INSERT ON project_tasks
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'Parent task must belong to the same project')
    WHERE NEW.parent_id IS NOT NULL
      AND EXISTS (
          SELECT 1 FROM project_tasks p
          WHERE p.id = NEW.parent_id AND p.project_id != NEW.project_id
      );
    SELECT RAISE(ABORT, 'Task cannot be its own parent')
    WHERE NEW.parent_id = NEW.id;
END;

-- Same trigger for UPDATE (re-parenting).
CREATE TRIGGER IF NOT EXISTS trg_no_cross_project_parent_upd
BEFORE UPDATE OF parent_id ON project_tasks
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'Parent task must belong to the same project')
    WHERE NEW.parent_id IS NOT NULL
      AND EXISTS (
          SELECT 1 FROM project_tasks p
          WHERE p.id = NEW.parent_id AND p.project_id != NEW.project_id
      );
    SELECT RAISE(ABORT, 'Task cannot be its own parent')
    WHERE NEW.parent_id = NEW.id;
END;

-- 3. Track who made the assignment (delegation chain).
ALTER TABLE project_tasks ADD COLUMN assigned_by INTEGER REFERENCES employees(id);

INSERT INTO schema_migrations (version) VALUES ('011');

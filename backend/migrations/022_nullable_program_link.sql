-- Migration 022: Activities hang off the DEPARTMENT'S PLAN (a strategic goal)
-- instead of a program. A plan-linked activity inherits the program_id that
-- cascades down the goal tree (annual -> quarterly -> team), which is NULL
-- whenever the grand plan wasn't coined from a program. SQLite cannot DROP a
-- NOT NULL column, so rebuild the table (12-step procedure with the FK/trigger
-- re-creation the syntax requires).

PRAGMA foreign_keys=OFF;

CREATE TABLE program_activities_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER REFERENCES programs(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES program_activities(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    assignee_id INTEGER REFERENCES employees(id),
    start_date TEXT,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'not_started'
        CHECK(status IN ('not_started','in_progress','completed','on_hold','cancelled')),
    progress_pct REAL DEFAULT 0,
    weight REAL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    assigned_by INTEGER REFERENCES employees(id),
    sort_order INTEGER DEFAULT 0,
    strategic_goal_id INTEGER REFERENCES strategic_goals(id),
    org_unit_id INTEGER REFERENCES departments(id)
);

INSERT INTO program_activities_new
    (id, program_id, parent_id, title, description, assignee_id, start_date, due_date,
     status, progress_pct, weight, created_at, assigned_by, sort_order, strategic_goal_id, org_unit_id)
SELECT id, program_id, parent_id, title, description, assignee_id, start_date, due_date,
     status, progress_pct, weight, created_at, assigned_by, sort_order, strategic_goal_id, org_unit_id
FROM program_activities;

DROP TABLE program_activities;
ALTER TABLE program_activities_new RENAME TO program_activities;

CREATE INDEX IF NOT EXISTS idx_program_activities_program ON program_activities(program_id);
CREATE INDEX IF NOT EXISTS idx_program_activities_parent ON program_activities(parent_id);
CREATE INDEX IF NOT EXISTS idx_program_activities_assignee ON program_activities(assignee_id);
CREATE INDEX IF NOT EXISTS idx_program_activities_goal ON program_activities(strategic_goal_id);
CREATE INDEX IF NOT EXISTS idx_program_activities_org_unit ON program_activities(org_unit_id);

-- Recreate the cross-program parent rejection triggers (dropped with the
-- table). IS NOT (instead of !=) keeps NULL parent/program links legal: a
-- plan-linked activity and its drill-downs can both be program-less.
CREATE TRIGGER IF NOT EXISTS trg_no_cross_program_activity_parent
BEFORE INSERT ON program_activities
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'Activity must belong to the same program')
    WHERE NEW.parent_id IS NOT NULL
      AND EXISTS (
          SELECT 1 FROM program_activities p
          WHERE p.id = NEW.parent_id AND p.program_id IS NOT NEW.program_id
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
          WHERE p.id = NEW.parent_id AND p.program_id IS NOT NEW.program_id
      );
    SELECT RAISE(ABORT, 'Activity cannot be its own parent')
    WHERE NEW.parent_id = NEW.id;
END;

PRAGMA foreign_keys=ON;
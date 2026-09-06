-- Strategic Goals: cascading annual → quarterly → team → individual goals
CREATE TABLE IF NOT EXISTS strategic_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER REFERENCES strategic_goals(id),
    title TEXT NOT NULL,
    description TEXT,
    scope TEXT NOT NULL CHECK(scope IN ('annual', 'quarterly', 'team', 'individual')),
    owner_id INTEGER REFERENCES employees(id),
    assigned_to_id INTEGER REFERENCES employees(id),
    org_unit_id INTEGER REFERENCES departments(id),
    cycle_id INTEGER REFERENCES performance_cycles(id),
    quarter TEXT,
    year INTEGER,
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'completed', 'cancelled')),
    progress_pct REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_strategic_goals_parent ON strategic_goals(parent_id);
CREATE INDEX IF NOT EXISTS idx_strategic_goals_owner ON strategic_goals(owner_id);
CREATE INDEX IF NOT EXISTS idx_strategic_goals_assigned ON strategic_goals(assigned_to_id);
CREATE INDEX IF NOT EXISTS idx_strategic_goals_org_unit ON strategic_goals(org_unit_id);
CREATE INDEX IF NOT EXISTS idx_strategic_goals_status ON strategic_goals(status);

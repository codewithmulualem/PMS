-- 005_drop_users_role_check.sql
-- The roles table (via users.role_id) is the single source of truth for
-- authorization; the legacy users.role column predates it and carries a
-- CHECK that only admits four role names, making the seeded hr_manager role
-- unassignable. Rebuild the users table without that CHECK (the column is
-- kept as a display/back-compat denormalization and backfilled from role_id).
PRAGMA foreign_keys=OFF;

CREATE TABLE users_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    employee_id INTEGER REFERENCES employees(id),
    created_at TEXT DEFAULT (datetime('now')),
    role_id INTEGER REFERENCES roles(id)
);

INSERT INTO users_new (id, username, password_hash, role, employee_id, created_at, role_id)
    SELECT id, username, password_hash, role, employee_id, created_at, role_id FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- Keep the legacy column truthful for any row whose role_id points at a
-- role name that differs from what the old CHECK allowed.
UPDATE users SET role = COALESCE(
    (SELECT name FROM roles WHERE id = users.role_id),
    role
);

PRAGMA foreign_keys=ON;

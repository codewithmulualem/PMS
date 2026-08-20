-- 003_reference_data.sql
-- Reference/config data is now stored in the database instead of being
-- hardcoded in application code:
--   * settings              -> key/value store for policy thresholds + insight templates
--   * relationship_types    -> valid reporting-relationship types (frontend dropdown)
--   * competency_categories -> competency framework categories (frontend dropdown)
--   * demo_accounts         -> login-page quick-fill accounts (frontend)
--   * navigation_items      -> per-role sidebar navigation (frontend)
-- Approval hardening:
--   * evaluation_assignments.designated_approver_id -> admin-assigned approver for
--     chain-exhausted evaluations (admin/executive can no longer approve directly).

CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS relationship_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS competency_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS demo_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL,
    note TEXT,
    sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS navigation_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    item_key TEXT NOT NULL,
    label TEXT NOT NULL,
    icon TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0
);

ALTER TABLE evaluation_assignments ADD COLUMN designated_approver_id INTEGER REFERENCES employees(id);

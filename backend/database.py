import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "pms.db")
SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "schema.sql")
MIGRATIONS_DIR = os.path.join(os.path.dirname(__file__), "migrations")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _ensure_schema_migrations(conn):
    conn.execute(
        """CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TEXT DEFAULT (datetime('now'))
        )"""
    )


def apply_migrations(conn):
    """Applies any .sql files in migrations/ that have not yet been applied,
    in filename order. Each file is recorded in schema_migrations once its
    script has run, so a database can never be re-migrated out of order."""
    _ensure_schema_migrations(conn)
    applied = {
        row["version"]
        for row in conn.execute("SELECT version FROM schema_migrations").fetchall()
    }
    if not os.path.isdir(MIGRATIONS_DIR):
        return
    for filename in sorted(f for f in os.listdir(MIGRATIONS_DIR) if f.endswith(".sql")):
        version = filename[:-4]
        if version in applied:
            continue
        with open(os.path.join(MIGRATIONS_DIR, filename), "r") as f:
            conn.executescript(f.read())
        conn.execute("INSERT INTO schema_migrations (version) VALUES (?)", (version,))
        conn.commit()


def init_db():
    conn = get_db()
    with open(SCHEMA_PATH, "r") as f:
        conn.executescript(f.read())
    apply_migrations(conn)
    # Seed default rating bands + weights if empty
    cur = conn.execute("SELECT COUNT(*) c FROM rating_bands")
    if cur.fetchone()["c"] == 0:
        conn.executemany(
            "INSERT INTO rating_bands (min_score, max_score, label, color) VALUES (?,?,?,?)",
            [
                (90, 100.01, "Exceptional", "#1a7f37"),
                (80, 90, "Exceeds Expectations", "#2f9e44"),
                (70, 80, "Meets Expectations", "#f0a500"),
                (60, 70, "Partially Meets Expectations", "#e8590c"),
                (0, 60, "Needs Improvement", "#c92a2a"),
            ],
        )
    cur = conn.execute("SELECT COUNT(*) c FROM score_weights WHERE cycle_id IS NULL")
    if cur.fetchone()["c"] == 0:
        conn.execute(
            "INSERT INTO score_weights (cycle_id, kpi_weight, goal_weight, competency_weight, behavior_weight, program_weight) "
            "VALUES (NULL, 40, 25, 15, 10, 10)"
        )
    conn.commit()
    conn.close()


def row_to_dict(row):
    return dict(row) if row else None


def rows_to_list(rows):
    return [dict(r) for r in rows]

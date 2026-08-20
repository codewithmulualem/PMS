"""Configuration values stored in the DB (settings table).

Policy thresholds and other tunables live as data so they can change without a
deploy. Each getter falls back to a code default when the key is absent.
"""


def get_setting(db, key, default=None, cast=None):
    """Read a setting value from the DB. Falls back to `default` when the key
    is missing or cannot be cast to the requested type."""
    row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    value = row["value"] if row else default
    if cast is not None and value is not None:
        try:
            value = cast(value)
        except (TypeError, ValueError):
            return default
    return value


def all_settings(db):
    rows = db.execute("SELECT key, value, description, updated_at FROM settings ORDER BY key").fetchall()
    return [dict(r) for r in rows]

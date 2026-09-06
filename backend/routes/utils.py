import json
from flask import g


def log_audit(db, entity_type, entity_id, action, old_value=None, new_value=None, reason=None):
    db.execute(
        "INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value, changed_by, reason) "
        "VALUES (?,?,?,?,?,?,?)",
        (entity_type, entity_id, action,
         json.dumps(old_value, default=str) if old_value else None,
         json.dumps(new_value, default=str) if new_value else None,
         g.user.get("username", "system"),
         reason),
    )

# Security & Quality Remediation Plan

This plan addresses the Critical and High findings from the Assessment Findings Summary to secure the application for a true MVP release. 

## Phase 1: Critical Issues (Security & Configuration)

### C1 & C3: Hardcoded JWT Secret & `debug=True`
- **Location:** `backend/auth.py`, `backend/app.py`
- **Fix:** Remove the fallback `dev-secret-change-me-in-production`. If `PMS_JWT_SECRET` is not set, generate a random ephemeral key `secrets.token_urlsafe(32)` (this securely breaks sessions on restart rather than sharing a global dev key). Change `app.run(debug=True)` to use a `FLASK_DEBUG` environment variable, defaulting to `False`.

### C2: CORS Wildcard
- **Location:** `backend/app.py`
- **Fix:** Change the fallback for `ALLOWED_ORIGIN` from `*` to `http://localhost:5173` (the Vite default) to prevent CSRF/CORS vulnerabilities if accidentally deployed without configuring the environment variable.

### C4: Plaintext Demo Passwords
- **Location:** `backend/seed.py`
- **Fix:** Remove the literal `password123` from documentation and seed logs. Use the existing `auth.hash_password()` but prompt the user to check `.env` for the seed password, or dynamically generate and print one during the seed process.

### C5: In-Memory Rate Limiting
- **Location:** `backend/auth.py`
- **Fix:** While moving to Redis is out of scope for the immediate SQLite MVP, we can move the rate-limiting state to an SQLite table (`login_attempts`) to ensure rate limiting survives application restarts and works across multiple Gunicorn workers.

## Phase 2: High Issues (Performance & Reliability)

### H1: Double `db.commit()`
- **Location:** `backend/routes/org_routes.py` (and potentially others)
- **Fix:** Remove redundant `db.commit()` calls. The `_log` function should rely on the caller to commit the transaction, ensuring atomic inserts of both the entity and its audit log.

### H2: No Pagination
- **Location:** All `GET` list routes (e.g., `/api/employees`, `/api/departments`)
- **Fix:** Implement a basic `LIMIT` and `OFFSET` pagination mechanism for endpoints that scale with the organization size (especially `/api/audit` and `/api/employees`).

### H3: N+1 Query in `_task_tree`
- **Location:** `backend/routes/project_routes.py`
- **Fix:** The loop executes `SELECT * FROM task_kpis WHERE task_id=?` for every task. We will refactor this to fetch all KPIs for the `project_id` in a single query and group them by `task_id` in Python memory.

### H4: `json.loads` Crash
- **Location:** `backend/routes/form_routes.py`
- **Fix:** Wrap `json.loads(q["options"])` in a `try...except json.JSONDecodeError` block and fallback to `[]` to prevent malformed database rows from 500-erroring the entire form payload.

### H5 & H7: Unfiltered Approval Query & Wrong Table Reference
- **Location:** `backend/routes/form_routes.py`
- **Fix:** Ensure approval queries explicitly verify that `g.user["employee_id"]` matches the `approver_id`. Audit and correct the table joins between `evaluation_assignments` and `approval_requests`.

### H6: Migration Self-Records
- **Location:** `backend/database.py`
- **Fix:** The `apply_migrations` function executes the script and then inserts into `schema_migrations`. If a `.sql` migration file contains its own `INSERT INTO schema_migrations`, this causes an IntegrityError. We will strip or skip manual inserts in the `.sql` files, relying on the Python runner to record the version.

## Open Questions
> [!NOTE]
> 1. Should we move the in-memory rate limiting (C5) to SQLite immediately, or just add a warning to the logs that it won't work across multiple workers?
> 2. For H2 (Pagination), are there specific routes you want prioritized, or should I implement a generic `?page=1&size=50` across all list endpoints?

Please review and approve this plan, and I will begin execution.

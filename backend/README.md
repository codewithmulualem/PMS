# EPA PMS — Environmental Performance Management System

Backend REST API for the Ethiopian Environmental Protection Authority's
Performance Management System. SQLite + Flask, zero heavy dependencies,
transparent scoring engine, rule-based AI insight layer (swap-in point for
a real LLM is clearly marked).

## Setup

```bash
cd backend
python3 -m venv venv && source venv/bin/activate   # optional but recommended
pip install -r requirements.txt

python3 seed.py      # creates pms.db and loads demo data
python3 app.py        # runs on http://127.0.0.1:5001
```

## Database migrations

`database.py` applies `schema.sql` (idempotent base) followed by every
`migrations/*.sql` file not yet recorded in the `schema_migrations` table, in
filename order. To evolve the schema:

1. Add `backend/migrations/NNN_name.sql` with the next number.
2. Restart the app (or run `seed.py`) — it applies automatically.
3. Migrations must be additive (new tables / nullable columns) so they never
   destroy existing data.

## Demo accounts (password: `password123`)

| Username    | Role       | Notes                                      |
|-------------|------------|--------------------------------------------|
| `admin1`    | admin      | Rediat Amare, Head of Human Resources      |
| `exec1`     | executive  | Dr Lelise Neme, Director General           |
| `manager1`  | manager    | Tesfaye Girma, Director Env. Regulatory    |
| `manager2`  | manager    | Hirut Bekele, Director Env. Systems        |
| `employee1` | employee   | Dawit Tesfaye, Senior Environmental Officer|
| `employee2` | employee   | Fatuma Ahmed, Environmental Specialist     |
| `employee3` | employee   | Bereket Assefa, Climate Change Officer     |
| `employee4` | employee   | Sara Mohammed, Systems Administrator       |

The seed builds the EPA organizational hierarchy (Authority → Directorate →
Department → Team), positions per unit, reporting relationships, org history,
roles/permissions (RBAC), sample approval workflows, and notifications.

## EPA Organizational Structure

- **Authority level**: Office of the Director General
- **Directorate level**: Environmental Regulatory, Environmental System Establishment, Corporate Services
- **Department level**: Environmental Impact Assessment, Compliance & Enforcement, Environmental Standards, Climate Change Adaptation, etc.
- **Team level**: Specialized teams within each department

## Project layout

```
backend/
  app.py              # Flask app entrypoint, CORS, blueprint registration
  database.py         # sqlite connection, init, migration runner
  schema.sql          # base DB schema
  migrations/         # versioned, additive .sql migrations (applied in order)
  auth.py             # password hashing, JWT issuing, RBAC decorators
  scoring.py          # deterministic weighted scoring engine
  ai_engine.py        # rule-based AI insight / anomaly detection (LLM swap-in point documented inline)
  seed.py             # EPA demo data loader
  routes/
    auth_routes.py        # /api/auth/*
    org_routes.py         # /api/departments, /api/employees, /api/cycles, /api/audit
    kpi_routes.py         # /api/kpis
    goal_routes.py        # /api/goals
    competency_routes.py  # /api/competencies, /api/employee-competencies
    evaluation_routes.py  # /api/evaluations
    form_routes.py        # evaluation form workflow: /api/evaluation-forms, /api/me/evaluations, /api/approvals/pending
    dashboard_routes.py   # /api/employees/:id/dashboard, /api/managers/:id/team-dashboard, /api/executive/overview
    ai_routes.py          # /api/ai/employees/:id/insights, /api/ai/anomalies
    program_routes.py     # /api/programs, /api/programs/:id/activities, KPIs, progress logs
```

## Design principles

- **Explainable scoring**: `scoring.py` never returns a bare number — every
  response includes the KPI/Goal/Competency/Behavior/Program components and
  the weights used to combine them.
- **FACT vs CALCULATION vs AI INSIGHT vs PREDICTION**: the API keeps these
  distinct. Raw KPI/goal data is fact. `performance_scores` is calculation.
  `ai_insights` rows are tagged `summary` / `risk_flag` / `development` /
  `prediction` / `anomaly` and always carry `supporting_data` for traceability.
- **RBAC**: employees can only see themselves; managers can only see their
  direct reports (`auth.can_view_employee`); admins see everything.
  Self-assessments can only be submitted by the employee themself.
- **Audit trail**: `audit_log` records employee/department edits and every
  score recalculation. Extend `_log()` calls in the route modules to cover
  additional entities as you grow the MVP.
- **AI is advisory, not decisive**: nothing in `ai_engine.py` writes to
  `performance_scores` or approves/rejects anything — it only produces
  `ai_insights` rows for a human to read.

## Security notes before using this beyond a demo

- Set `PMS_JWT_SECRET` to a real secret via environment variable.
- Tighten `ALLOWED_ORIGIN` in `app.py` to your actual frontend origin instead of `*`.
- Put this behind a real WSGI server (gunicorn/uwsgi) — `app.run()` is dev-only.
- Move from SQLite to Postgres for concurrent multi-user production use.

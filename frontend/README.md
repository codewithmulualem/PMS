# PMS — Frontend (React + Vite)

MVP UI for the Enterprise Performance Management System. Talks to the Flask
backend over a plain fetch-based API client — no state management library,
no router library, kept intentionally minimal.

## Setup

```bash
cd frontend
npm install
cp .env.example .env    # defaults to "/api"; dev only — requests are same-origin via the Vite proxy
npm run dev              # http://localhost:5173
```

Make sure the backend (`../backend`) is running first — see its README for
setup and demo login accounts.

## Project layout

```
frontend/
  src/
    api.js                    # fetch wrapper, token storage (sessionStorage)
    App.jsx                    # role-aware page switcher (no router lib)
    context/AuthContext.jsx     # login/logout state
    components/
      Sidebar.jsx                # role-based nav
      ScoreRing.jsx                # circular overall-score gauge
      MeterRow.jsx                  # horizontal % bar used for score breakdowns
      RatingBadge.jsx                # colored rating pill
      EpistemicTag.jsx                # FACT / CALCULATION / AI INSIGHT / PREDICTION tag — see below
    pages/
      Login.jsx
      EmployeeDashboard.jsx          # score, KPIs, goals (editable progress), competencies, AI insights
      TeamDashboard.jsx               # manager's team overview, drills into EmployeeDashboard
      ExecutiveOverview.jsx            # org-wide averages, rating distribution, weakest KPIs
      EmployeesAdmin.jsx                # employee list + create form (admin)
      OrganizationSetup.jsx              # departments, cycles, competency framework (admin)
      AuditLog.jsx                        # score/entity change history (admin)
```

## Design system

Defined in `src/index.css` as CSS custom properties — no Tailwind or other
build-time CSS framework, to keep the dependency list minimal.

The one deliberate, content-driven design decision: **every number in the UI
is labeled with what kind of number it is** — Fact (slate), Calculation
(indigo), AI Insight (teal), or Prediction (amber, dashed). This directly
mirrors the platform's own governance principle that these must never be
visually interchangeable. See `EpistemicTag.jsx`.

## Notes

- Auth token is kept in `sessionStorage` (cleared on tab close) rather than
  `localStorage`, so a shared machine doesn't leave a session logged in.
- There's no client-side router; `App.jsx` swaps pages based on a `page`
  string in state. This is fine for an MVP's ~6 pages — reach for
  `react-router` if the page count grows.
- This frontend was written and reviewed but **not build-tested** in the
  environment that produced it (no network access to run `npm install`
  there). Run `npm run dev` and check the browser console on first run;
  the code follows standard React 18 + Vite conventions throughout.

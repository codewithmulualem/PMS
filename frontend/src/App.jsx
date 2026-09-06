import { useState, useEffect, useRef } from "react";
import { useAuth } from "./context/AuthContext";
import { useCycle } from "./context/CycleContext";
import Login from "./pages/Login";
import AppTopbar from "./components/AppTopbar";
import Sidebar from "./components/Sidebar";
import EmployeeHome from "./pages/EmployeeHome";
import EmployeeDashboard from "./pages/EmployeeDashboard";
import TeamDashboard from "./pages/TeamDashboard";
import ExecutiveOverview from "./pages/ExecutiveOverview";
import EmployeesAdmin from "./pages/EmployeesAdmin";
import OrganizationSetup from "./pages/OrganizationSetup";
import AnomaliesPage from "./pages/Anomalies";
import AuditLog from "./pages/AuditLog";
import MyEvaluations from "./pages/MyEvaluations";
import EvaluationApprovals from "./pages/EvaluationApprovals";
import EvaluationForms from "./pages/EvaluationForms";
import Programs from "./pages/Programs";
import StrategicGoals from "./pages/StrategicGoals";
import PeerReviews from "./pages/PeerReviews";
import DirectoratePlans from "./pages/DirectoratePlans";
import DepartmentPlans from "./pages/DepartmentPlans";
import TeamPlansPage from "./pages/TeamPlansPage";
import WeeklyTasks from "./pages/WeeklyTasks";
import { PAGE_META, ROLE_NAV } from "./i18n";

/* Kept as a local alias so existing page-selection logic stays easy to read. */
const TITLES = PAGE_META;

function getDefaultPage(role) {
  return {
    admin: "executive",
    executive: "executive",
    director: "directorate_plans",
    dept_head: "department_plans",
    team_leader: "team_plans",
    manager: "team",
    employee: "home",
  }[role];
}

// Defense-in-depth on top of backend authz: each role may only render the
// pages its navigation exposes. Disallowed pages fall back to the role default.
const ROLE_PAGES = ROLE_NAV;

export default function App() {
  const { user, ready } = useAuth();
  const { cycleId } = useCycle();
  const [page, setPage] = useState(() =>
    new URLSearchParams(window.location.search).get("page") || null
  );
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("pms_sidebar_collapsed") === "1");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const lastUserId = useRef(null);

  function toggleSidebar() {
    if (window.innerWidth <= 700) {
      setMobileNavOpen((o) => !o);
      return;
    }
    setCollapsed((c) => {
      localStorage.setItem("pms_sidebar_collapsed", c ? "0" : "1");
      return !c;
    });
  }

  // Reset to the new user's default page on sign-in/switch; otherwise a
  // logged-out admin's last page leaks into the next session (e.g. an
  // employee landing on the admin-only "organization" page). The very first
  // mount is allowed to keep a ?page= deep link (used by the prototype).
  useEffect(() => {
    if (user) {
      if (lastUserId.current && lastUserId.current !== user.id) setPage(null);
      lastUserId.current = user.id;
    } else {
      lastUserId.current = null;
      setPage(null);
    }
  }, [user]);

  if (!ready) return null;
  if (!user) return <Login />;

  const activePage = page || getDefaultPage(user.role);
  const allowed = ROLE_PAGES[user.role] || [];
  const effectivePage = allowed.includes(activePage) ? activePage : getDefaultPage(user.role);
  const meta = TITLES[effectivePage] || TITLES.executive;

  let content;
  switch (effectivePage) {
    case "home":
      content = <EmployeeHome setPage={setPage} />;
      break;
    case "weekly_tasks":
      content = <WeeklyTasks />;
      break;
    case "myself":
      content = <EmployeeDashboard employeeId={user.employee_id} />;
      break;
    case "team":
      content = <TeamDashboard managerId={user.employee_id} />;
      break;
    case "employees":
      content = <EmployeesAdmin />;
      break;
    case "organization":
      content = <OrganizationSetup />;
      break;
    case "programs":
      content = <Programs />;
      break;
    case "strategic_goals":
      content = <StrategicGoals />;
      break;
    case "anomalies":
      content = <AnomaliesPage />;
      break;
    case "audit":
      content = <AuditLog />;
      break;
    case "evaluations":
      content = <MyEvaluations />;
      break;
    case "peer_reviews":
      content = <PeerReviews />;
      break;
    case "approvals":
      content = <EvaluationApprovals />;
      break;
    case "forms":
      content = <EvaluationForms />;
      break;
    case "directorate_plans":
      content = <DirectoratePlans />;
      break;
    case "department_plans":
      content = <DepartmentPlans />;
      break;
    case "team_plans":
      content = <TeamPlansPage />;
      break;
    default:
      content = <ExecutiveOverview />;
  }

  return (
    <div className="app-shell">
      <div
        className={`nav-scrim ${mobileNavOpen ? "show" : ""}`}
        onClick={() => setMobileNavOpen(false)}
        aria-hidden="true"
      />
      <Sidebar
        page={effectivePage}
        setPage={setPage}
        collapsed={collapsed}
        open={mobileNavOpen}
        onNavigate={() => setMobileNavOpen(false)}
      />
      <div className="app-main">
        <AppTopbar title={meta.title} collapsed={collapsed} onToggle={toggleSidebar} />
        <main className="main">
          <div className="main-content">
            {/* key on cycleId forces dashboards to reload data when the cycle changes */}
            <div key={`${effectivePage}-${cycleId}`} className="page-enter">
              {content}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

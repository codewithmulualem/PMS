import { useState, useEffect } from "react";
import { useAuth } from "./context/AuthContext";
import { useCycle } from "./context/CycleContext";
import Login from "./pages/Login";
import AppTopbar from "./components/AppTopbar";
import Sidebar from "./components/Sidebar";
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

const TITLES = {
  executive: { title: "Executive Overview", sub: "Organization-wide performance intelligence" },
  myself: { title: "My Performance", sub: "Your personal performance record" },
  team: { title: "My Team", sub: "Your direct reports" },
  evaluations: { title: "My Evaluations", sub: "Evaluation forms you must complete" },
  approvals: { title: "Evaluation Approvals", sub: "Forms awaiting your review" },
  forms: { title: "Evaluation Forms", sub: "Form templates and assignments" },
  employees: { title: "Employees", sub: "People and performance in the organization" },
  organization: { title: "Organization Setup", sub: "Structure, cycles, scoring weights, competencies" },
  programs: { title: "Programs", sub: "Environmental program and activity evaluation — automated accomplishment scoring" },
  anomalies: { title: "AI Anomaly Signals", sub: "Patterns flagged for human review — never automatic verdicts" },
  audit: { title: "Audit Log", sub: "Every score, KPI, evaluation, and AI-assisted action is recorded" },
};

function getDefaultPage(role) {
  return { admin: "executive", executive: "executive", manager: "team", employee: "myself" }[role];
}

// Defense-in-depth on top of backend authz: each role may only render the
// pages its navigation exposes. Disallowed pages fall back to the role default.
const ROLE_PAGES = {
  admin: ["executive", "myself", "team", "evaluations", "approvals", "forms", "employees", "organization", "programs", "anomalies", "audit"],
  executive: ["executive", "team", "employees", "programs", "approvals", "evaluations", "myself"],
  manager: ["team", "programs", "approvals", "evaluations", "myself"],
  employee: ["programs", "evaluations", "myself"],
};

export default function App() {
  const { user, ready } = useAuth();
  const { cycleId } = useCycle();
  const [page, setPage] = useState(null);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("pms_sidebar_collapsed") === "1");

  function toggleSidebar() {
    setCollapsed((c) => {
      localStorage.setItem("pms_sidebar_collapsed", c ? "0" : "1");
      return !c;
    });
  }

  // Reset to the new user's default page on sign-in/switch; otherwise a
  // logged-out admin's last page leaks into the next session (e.g. an
  // employee landing on the admin-only "organization" page).
  useEffect(() => {
    setPage(null);
  }, [user?.id]);

  if (!ready) return null;
  if (!user) return <Login />;

  const activePage = page || getDefaultPage(user.role);
  const allowed = ROLE_PAGES[user.role] || [];
  const effectivePage = allowed.includes(activePage) ? activePage : getDefaultPage(user.role);
  const meta = TITLES[effectivePage] || TITLES.executive;

  let content;
  switch (effectivePage) {
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
    case "anomalies":
      content = <AnomaliesPage />;
      break;
    case "audit":
      content = <AuditLog />;
      break;
    case "evaluations":
      content = <MyEvaluations />;
      break;
    case "approvals":
      content = <EvaluationApprovals />;
      break;
    case "forms":
      content = <EvaluationForms />;
      break;
    default:
      content = <ExecutiveOverview />;
  }

  return (
    <div className="app-shell">
      <Sidebar page={effectivePage} setPage={setPage} collapsed={collapsed} />
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

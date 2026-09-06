import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useCycle } from "../context/CycleContext";
import { api } from "../api";
import { Icons } from "../components/icons";
import {
  ExecutiveTab,
  ProgramsTab,
  StrategicGoalsTab,
  ApprovalsTab,
  TeamTab,
  DirectoratePlansTab,
  DepartmentPlansTab,
  TeamPlansTab,
  PeerReviewsTab,
  EmployeesTab,
  OrganizationTab,
  FormsTab,
  AnomaliesTab,
  AuditTab,
} from "./screens";

const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
];

const STATUS = {
  draft: "To Do",
  submitted: "Pending review",
  rejected: "Needs revision",
  approved: "Approved",
  scored: "Scored",
};
const STATUS_CHIP = {
  draft: "indigo",
  submitted: "warn",
  rejected: "red",
  approved: "green",
  scored: "green",
};

const TABS = [
  { key: "home", label: "Home", icon: "dashboard" },
  { key: "tasks", label: "Tasks", icon: "calendar" },
  { key: "evals", label: "Reviews", icon: "clipboard" },
  { key: "score", label: "Score", icon: "chart" },
  { key: "more", label: "Menu", icon: "menu" },
];

const TAB_META = {
  home: { title: "Home", sub: "Your dashboard at a glance" },
  tasks: { title: "Weekly Tasks", sub: "Plan your week and focus on today" },
  evals: { title: "Reviews", sub: "Evaluation forms you must complete" },
  score: { title: "Score", sub: "Your personal performance record" },
  more: { title: "Menu", sub: "Account and app info" },
  executive: { title: "Executive Overview", sub: "Organisation performance at a glance" },
  programs: { title: "Programs", sub: "Institutional programs in this cycle" },
  strategic_goals: { title: "Strategic Goals", sub: "The goal tree for your scope" },
  approvals: { title: "Approvals", sub: "Evaluation levels waiting on you" },
  team: { title: "My Team", sub: "Your direct reports' performance" },
  directorate_plans: { title: "Directorate Plans", sub: "Progress across your units" },
  department_plans: { title: "Department Plans", sub: "Work plans under each team" },
  team_plans: { title: "Team Plans", sub: "Your team's work plan" },
  peer_reviews: { title: "Peer Reviews", sub: "Colleagues you must assess" },
  employees: { title: "Employees", sub: "Browse people in your organisation" },
  organization: { title: "Organization Setup", sub: "Cycles and competency framework" },
  forms: { title: "Evaluation Forms", sub: "Form templates in the system" },
  anomalies: { title: "AI Anomalies", sub: "Assistant-powered pattern signals" },
  audit: { title: "Audit Log", sub: "Recent system events" },
};

// Navigation items that have a real screen inside this mobile prototype.
// Every other item from /me/navigation is still listed, and opens the full
// desktop app at that page.
const PROTO_PAGE = {
  home: "home",
  weekly_tasks: "tasks",
  evaluations: "evals",
  myself: "score",
  executive: "executive",
  programs: "programs",
  strategic_goals: "strategic_goals",
  approvals: "approvals",
  team: "team",
  directorate_plans: "directorate_plans",
  department_plans: "department_plans",
  team_plans: "team_plans",
  peer_reviews: "peer_reviews",
  employees: "employees",
  organization: "organization",
  forms: "forms",
  anomalies: "anomalies",
  audit: "audit",
};

const FALLBACK_NAV = [
  { item_key: "home", label: "Home", icon: "dashboard" },
  { item_key: "weekly_tasks", label: "Weekly Tasks", icon: "calendar" },
  { item_key: "evaluations", label: "My Evaluations", icon: "clipboard" },
  { item_key: "myself", label: "My Performance", icon: "target" },
];

function useNav() {
  const { user } = useAuth();
  const [nav, setNav] = useState(FALLBACK_NAV);
  const [pending, setPending] = useState({});

  useEffect(() => {
    if (!user) { setNav(FALLBACK_NAV); return; }
    let alive = true;
    api
      .get("/me/navigation")
      .then((rows) => {
        if (!alive) return;
        setNav(Array.isArray(rows) && rows.length ? rows : FALLBACK_NAV);
        if (["director", "dept_head", "team_leader", "manager"].includes(user.role) && user.employee_id) {
          api.get(`/managers/${user.employee_id}/team-dashboard`)
            .then((d) => alive && setPending((p) => ({ ...p, team: d.evaluations_pending || 0 })))
            .catch(() => {});
        }
        if (["director", "dept_head", "team_leader", "manager", "executive", "admin"].includes(user.role)) {
          api.get("/approvals/pending")
            .then((d) => alive && setPending((p) => ({ ...p, approvals: Array.isArray(d) ? d.length : 0 })))
            .catch(() => {});
        }
      })
      .catch(() => alive && setNav(FALLBACK_NAV));
    return () => { alive = false; };
  }, [user]);
  return { nav, pending };
}

// One row renderer shared by the desktop sidebar and the mobile drawer.
function NavEntry({ item, className, tab, badge, onClick, title }) {
  const resolved = PROTO_PAGE[item.item_key];
  const active = resolved != null && resolved === tab;
  const NavIcon = Icons[item.icon] || Icons.target;
  return (
    <button key={item.item_key} className={`${className} ${active ? "active" : ""}`} onClick={() => onClick(item)} title={title}>
      <span className="dot"><NavIcon size={19} /></span>
      <span className="proto-side-label">{item.label}</span>
      {badge > 0 ? (
        <span className="proto-entry-badge">{badge}</span>
      ) : resolved == null ? (
        <Icons.external size={13} className="proto-entry-external" />
      ) : null}
    </button>
  );
}

// Layout is driven by the width of the app container itself (not the real
// browser window), so the same prototype renders a phone layout inside a
// phone frame and a desktop/sidebar layout inside a desktop frame.
function useContainerWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, compact: width < 760 };
}

function TabIcon({ name, size = 22, ...props }) {
  const Cmp = Icons[name] || Icons.dashboard;
  return <Cmp size={size} {...props} />;
}

function Ring({ value, label = "SCORE", color = "#8b9bf5" }) {
  const R = 44;
  const C = 2 * Math.PI * R;
  const pct = value != null ? Math.min(100, Math.max(0, value)) : 0;
  return (
    <div className="proto-ring">
      <svg width="96" height="96">
        <circle className="track" cx="48" cy="48" r={R} strokeWidth="9" />
        <circle
          className="bar"
          cx="48" cy="48" r={R}
          stroke={color}
          strokeWidth="9"
          strokeDasharray={C}
          strokeDashoffset={C - (C * pct) / 100}
        />
      </svg>
      <div className="proto-ring-label">
        <span className="proto-ring-number">{value != null ? Math.round(value) : "—"}</span>
        <span className="proto-ring-unit">{label}</span>
      </div>
    </div>
  );
}

function Spinner() {
  return <div className="proto-empty"><span className="big"><Icons.spinner size={26} /></span>Loading…</div>;
}

function ErrorBox({ msg }) {
  if (!msg) return null;
  return <div className="proto-error">{msg}</div>;
}

/* ------------------------------------------------------------------ */

export default function PrototypeApp() {
  const { user, ready } = useAuth();
  const { ref, compact } = useContainerWidth();

  if (!ready) return null;
  return (
    <div ref={ref} className={`proto-app-root ${compact ? "proto-compact" : "proto-wide"}`}>
      {!user ? <LoginScreen /> : <Shell compact={compact} />}
    </div>
  );
}

/* ----------------------------- Login ----------------------------- */

function LoginScreen() {
  const { login } = useAuth();
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState(import.meta.env.VITE_DEMO_PASSWORD || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function doLogin(u = userName) {
    setError(null);
    setSaving(true);
    try {
      await login(u.trim(), password);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const quick = ["employee1", "lead1", "depthead1", "director1", "exec1", "admin1"];

  return (
    <div className="proto-login">
      <div className="brand-lockup">
        <div className="proto-brand-mark">EP</div>
        <div>
          <div style={{ fontWeight: 800, fontSize: 19 }}>EPA PMS</div>
          <div style={{ fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".12em" }}>
            Mobile prototype
          </div>
        </div>
      </div>
      <h1>Welcome</h1>
      <p className="sub">Sign in to view your performance on the go.</p>
      <ErrorBox msg={error} />
      <div className="proto-field">
        <label>Username</label>
        <input value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="e.g. employee1" autoComplete="username" />
      </div>
      <div className="proto-field">
        <label>Password</label>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="••••••" autoComplete="current-password" />
      </div>
      <button className="proto-btn-primary" disabled={saving || !userName.trim()} onClick={() => doLogin()}>
        {saving ? "Signing in…" : "Sign in"}
      </button>
      <div className="proto-quick">
        {quick.map((u) => (
          <button key={u} disabled={saving} onClick={() => doLogin(u)}>{u}</button>
        ))}
      </div>
      <div className="proto-note">
        Prototype only — quick buttons require <span className="mono">VITE_DEMO_PASSWORD</span> to be configured.
        Uses the same backend as the desktop app.
      </div>
    </div>
  );
}

/* ----------------------------- Shell ----------------------------- */

function Shell({ compact }) {
  const { user, logout } = useAuth();
  const { cycleId, current } = useCycle();
  const { nav, pending } = useNav();
  const [tab, setTab] = useState("home");
  const [sheet, setSheet] = useState(null);
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const tabs = TABS.map((t) => ({ ...t, badge: 0 }));
  const meta = TAB_META[tab] || TAB_META.home;

  function go(k) {
    setTab(k);
    setDrawer(false);
  }

  function openDesktop(page) {
    window.location.href = `/?page=${encodeURIComponent(page)}`;
  }

  function onNav(item) {
    const resolved = PROTO_PAGE[item.item_key];
    if (resolved) { go(resolved); return; }
    openDesktop(item.item_key);
  }

  function badgeFor(item) {
    if (item.item_key === "team") return pending.team || 0;
    if (item.item_key === "approvals") return pending.approvals || 0;
    return 0;
  }

  const tabContent = (
    <>
      {tab === "home" && <HomeTab go={go} openSheet={setSheet} />}
      {tab === "tasks" && <TasksTab />}
      {tab === "evals" && <EvaluationsTab openSheet={setSheet} />}
      {tab === "score" && <ScoreTab />}
      {tab === "more" && <MoreTab onSignOut={logout} />}
      {tab === "executive" && <ExecutiveTab />}
      {tab === "programs" && <ProgramsTab openSheet={setSheet} />}
      {tab === "strategic_goals" && <StrategicGoalsTab />}
      {tab === "approvals" && <ApprovalsTab openSheet={setSheet} />}
      {tab === "team" && <TeamTab />}
      {tab === "directorate_plans" && <DirectoratePlansTab />}
      {tab === "department_plans" && <DepartmentPlansTab />}
      {tab === "team_plans" && <TeamPlansTab />}
      {tab === "peer_reviews" && <PeerReviewsTab openSheet={setSheet} />}
      {tab === "employees" && <EmployeesTab />}
      {tab === "organization" && <OrganizationTab />}
      {tab === "forms" && <FormsTab />}
      {tab === "anomalies" && <AnomaliesTab />}
      {tab === "audit" && <AuditTab />}
    </>
  );

  const sheetEl = sheet && <BottomSheet title={sheet.title} onClose={() => setSheet(null)}>{sheet.body}</BottomSheet>;

  if (!compact) {
    return (
      <div className="proto-desktop">
        <aside className={`proto-sidebar ${collapsed ? "collapsed" : ""}`}>
          <div className="proto-brand">
            <div className="proto-brand-mark">EP</div>
            {!collapsed && (
              <div>
                <div className="proto-brand-name">EPA PMS</div>
                <div className="proto-brand-sub">Environmental performance</div>
              </div>
            )}
          </div>
          <nav className="proto-side-nav">
            <div className="proto-side-label-head">Workspace</div>
            {nav.map((item) => (
              <NavEntry
                key={item.item_key}
                item={item}
                className="proto-side-item"
                tab={tab}
                badge={badgeFor(item)}
                onClick={onNav}
                title={collapsed ? item.label : undefined}
              />
            ))}
            <div className="proto-side-sep" />
            <button
              className={`proto-side-item ${tab === "more" ? "active" : ""}`}
              onClick={() => go("more")}
              title={collapsed ? "Account & menu" : undefined}
            >
              <span className="dot"><TabIcon name="user" size={19} /></span>
              {!collapsed && <span className="proto-side-label">Account & menu</span>}
            </button>
          </nav>
          <div className="proto-side-foot">
            <div className="proto-avatar">{initials(user.employee?.full_name || user.username)}</div>
            {!collapsed && (
              <>
                <div className="who">
                  <b>{user.employee?.full_name || user.username}</b>
                  <span>{user.role}</span>
                </div>
                <button className="proto-btn-signout" onClick={logout} title="Sign out">
                  <Icons.logout size={17} />
                </button>
              </>
            )}
          </div>
        </aside>
        <div className="proto-main">
          <header className="proto-topbar-wide">
            <button
              className="proto-icon-btn"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <Icons.menu size={19} />
            </button>
            <div className="proto-page-title">
              <b>{meta.title}</b>
              <span>{meta.sub}</span>
            </div>
            <span className="spacer" />
            {current && <span className="proto-chip proto-chip-indigo">{current.name}</span>}
            <div className="proto-topbar-avatar">{initials(user.employee?.full_name || user.username)}</div>
          </header>
          <div className="proto-main-scroll">
            <div className="proto-main-inner">
              {tabContent}
              <div style={{ height: 12 }} />
            </div>
          </div>
        </div>
        {sheetEl}
      </div>
    );
  }

  return (
    <div className="proto-shell">
      <header className="proto-topbar">
        <button className="proto-icon-btn" onClick={() => setDrawer(true)} aria-label="Open navigation menu">
          <Icons.menu size={20} />
        </button>
        <div className="proto-brand">
          <div className="proto-brand-mark">EP</div>
          <div>
            <div className="proto-brand-name">EPA PMS</div>
            <div className="proto-brand-sub">{current ? current.name : (cycleId ? "Cycle" : "Prototype")}</div>
          </div>
        </div>
        <span className="spacer" />
        <span className="proto-chip proto-chip-indigo">{user.role}</span>
        <div className="proto-avatar">{initials(user.employee?.full_name || user.username)}</div>
      </header>

      <div className="proto-scroll">
        {tabContent}
        <div style={{ height: 8 }} />
      </div>

      <nav className="proto-tabs">
        {tabs.map((t) => (
          <button key={t.key} className={`proto-tab ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
            <span className="dot">
              <TabIcon name={t.icon} />
              {t.badge > 0 && <span className="badge">{t.badge}</span>}
            </span>
            {t.label}
          </button>
        ))}
      </nav>

      {drawer && (
        <NavDrawer
          onClose={() => setDrawer(false)}
          tab={tab}
          go={go}
          user={user}
          nav={nav}
          pending={pending}
          badgeFor={badgeFor}
          onNav={onNav}
          onSignOut={logout}
          cycleLabel={current?.name || (cycleId ? `Cycle #${cycleId}` : "—")}
        />
      )}

      {sheetEl}
    </div>
  );
}

/* --------------------------- Mobile drawer --------------------------- */

function NavDrawer({ onClose, tab, go, user, nav, pending, badgeFor, onNav, onSignOut, cycleLabel }) {
  return (
    <div className="proto-drawer-root">
      <div className="proto-scrim show" onClick={onClose} aria-hidden="true" />

      <aside className="proto-drawer open">
        <div className="proto-drawer-head">
          <div className="proto-brand-mark">EP</div>
          <div>
            <div className="proto-drawer-brand">EPA PMS</div>
            <div className="proto-drawer-sub">Environmental performance</div>
          </div>
        </div>

        <div className="proto-drawer-user">
          <div className="proto-avatar">{initials(user.employee?.full_name || user.username)}</div>
          <div className="who">
            <b>{user.employee?.full_name || user.username}</b>
            <span>{user.employee?.position || user.role}</span>
          </div>
        </div>

        <div className="proto-drawer-group">
          <div className="proto-drawer-label">Workspace</div>
          {nav.map((item) => (
            <NavEntry
              key={item.item_key}
              item={item}
              className="proto-drawer-item"
              tab={tab}
              badge={badgeFor(item)}
              onClick={onNav}
            />
          ))}
        </div>

        <div className="proto-drawer-group">
          <div className="proto-drawer-label">Account</div>
          <button className={`proto-drawer-item ${tab === "more" ? "active" : ""}`} onClick={() => go("more")}>
            <span className="dot"><TabIcon name="user" size={17} /></span>
            <span className="proto-side-label">Account & app info</span>
            {tab === "more" && <Icons.chevronRight size={14} className="proto-drawer-check" />}
          </button>
          <button className="proto-drawer-item" onClick={() => { window.location.href = "/"; }}>
            <span className="dot"><TabIcon name="external" size={17} /></span>
            <span className="proto-side-label">Open desktop app</span>
          </button>
          <button className="proto-drawer-item danger" onClick={onSignOut}>
            <span className="dot"><TabIcon name="logout" size={17} /></span>
            <span className="proto-side-label">Sign out</span>
          </button>
        </div>

        <div className="proto-drawer-foot">Active cycle — {cycleLabel}</div>
      </aside>
    </div>
  );
}

function initials(name = "") {
  return name.split(" ").filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join("");
}

/* ----------------------------- Home ----------------------------- */

function useDashboard() {
  const { user } = useAuth();
  const { cycleId } = useCycle();
  const [data, setData] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get(`/employees/${user.employee_id}/dashboard?cycle_id=${cycleId || ""}`),
      api.get("/weekly-plans/today"),
      api.get("/me/evaluations"),
    ])
      .then(([dash, today, evals]) => {
        if (!alive) return;
        setData(dash);
        setTasks(today);
        setError(null);
      })
      .catch((err) => alive && setError(err.message));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.employee_id, cycleId]);

  return { data, tasks, error };
}

function HomeTab({ go, openSheet }) {
  const { data, tasks, error } = useDashboard();
  const { user } = useAuth();
  if (error) return <ErrorBox msg={error} />;
  if (!data) return <Spinner />;

  const score = data.score;
  const pendingEvals = (data.evaluations || []).filter(
    (e) => e.status === "draft" || e.status === "rejected"
  ).length;
  const doneToday = (tasks?.today || []).filter((t) => t.status === "done").length;
  const todayList = tasks?.today || [];
  const benches = data.benchmarks || {};

  const statTiles = [
    { b: doneToday, s: `${todayList.length} today` },
    { b: pendingEvals, s: `review${pendingEvals === 1 ? "" : "s"} open` },
    { b: data.history?.length || 0, s: "cycles logged" },
  ];

  return (
    <>
      <div className="proto-hero">
        <div className="proto-ring-wrap">
          <Ring value={score?.overall_score} color={score?.rating?.color || "#8b9bf5"} />
        </div>
        <div className="proto-hero-meta">
          <div className="proto-hero-name">{user.employee?.full_name || user.username}</div>
          <div className="proto-hero-title">{user.employee?.position || ""}</div>
          <div className="proto-hero-grade">
            <span className="grade-tag" style={{ background: score?.rating?.color || "var(--indigo)" }}>
              {score?.rating?.label || "Not scored yet"}
            </span>
          </div>
          <div className="proto-benches">
            <span className="proto-bench">Team <b>{benches.team_average ?? "—"}</b></span>
            <span className="proto-bench">Org <b>{benches.organization_average ?? "—"}</b></span>
            {data.previous_score != null && <span className="proto-bench">Prev <b>{Math.round(data.previous_score)}</b></span>}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="proto-stats">
          {statTiles.map((t, i) => (
            <div className="proto-stat" key={i}><b>{t.b}</b><span>{t.s}</span></div>
          ))}
        </div>
      </div>

      <div className="proto-section-title">Today</div>
      <div className="proto-card">
        {todayList.length === 0 ? (
          <div className="proto-empty"><span className="big">🗓</span>Nothing scheduled today — plan your week.</div>
        ) : (
          todayList.slice(0, 4).map((t) => (
            <div key={t.id} className={`proto-row ${t.status === "done" ? "done" : ""}`}>
              <Check on={t.status === "done"} />
              <div className="proto-row-main"><div className="proto-row-title">{t.title}</div></div>
              <span className={`proto-chip proto-chip-${t.status === "done" ? "green" : "gray"}`}>{statusLabel(t.status)}</span>
            </div>
          ))
        )}
        <button className="proto-add" style={{ width: "100%", background: "none", border: "none", padding: 0 }} onClick={() => go("tasks")}>
          <div style={{ flex: 1, textAlign: "center", padding: "12px", border: "1px dashed var(--line-strong)", borderRadius: 14, color: "var(--indigo)", fontWeight: 600, fontSize: 13 }}>
            Open weekly tasks →
          </div>
        </button>
      </div>

      <div className="proto-section-title">Waiting on you</div>
      <div className="proto-card">
        {(data.evaluations || []).filter((e) => e.status === "draft" || e.status === "rejected").length === 0 ? (
          <div className="proto-empty"><span className="big">✓</span>You're all caught up.</div>
        ) : (
          (data.evaluations || [])
            .filter((e) => e.status === "draft" || e.status === "rejected")
            .slice(0, 5)
            .map((e) => (
              <div key={e.id} className="proto-row" onClick={() => openSheet({
                title: e.form_name,
                body: <EvalDetail e={e} />,
              })}>
                <div className="proto-row-main">
                  <div className="proto-row-title">{evalTitle(e)}</div>
                  <div className="proto-row-sub">{e.subject_name} · {e.evaluator_type}</div>
                </div>
                <Icons.chevronRight size={16} style={{ color: "var(--text-faint)" }} />
              </div>
            ))
        )}
      </div>
    </>
  );
}

function statusLabel(s) {
  return STATUS[s] || s;
}

function evalTitle(e) {
  if (e.evaluator_type === "self") return "Rate yourself";
  if (e.evaluator_type === "peer") return `Rate ${e.subject_name}`;
  return `Review ${e.subject_name}`;
}

/* ----------------------------- Tasks ----------------------------- */

function Check({ on }) {
  return <div className={`proto-check ${on ? "on" : ""}`}>{on && <Icons.check size={16} strokeWidth={3} />}</div>;
}

function useTasks() {
  const { user } = useAuth();
  const [state, setState] = useState({ loading: true, plan: null, tasks: [], today: null, error: null });

  async function load() {
    try {
      const [cur, today] = await Promise.all([api.get("/weekly-plans/current"), api.get("/weekly-plans/today")]);
      setState({ loading: false, plan: cur.plan, tasks: cur.tasks || [], today, error: null });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.employee_id]);

  async function update(next) {
    setState((s) => ({ ...s, tasks: next }));
    try {
      await api.post("/weekly-plans/current", { tasks: next });
      load();
    } catch (err) {
      setState((s) => ({ ...s, error: err.message }));
    }
  }

  function toggle(task) {
    update(state.tasks.map((t) => (t.id === task.id ? { ...t, status: t.status === "done" ? "in_progress" : "done" } : t)));
  }
  function setStatus(task, status) {
    update(state.tasks.map((t) => (t.id === task.id ? { ...t, status } : t)));
  }

  return { ...state, update, toggle, setStatus, reload: load };
}

function TasksTab() {
  const toast = useToast();
  const t = useTasks();
  const [view, setView] = useState("daily");
  const [newTitle, setNewTitle] = useState("");
  const [newDay, setNewDay] = useState(null);

  const todayDay = t.today?.day && t.today.day >= 1 && t.today.day <= 5 ? t.today.day : null;
  const todayList = t.today?.today || [];
  const doneToday = todayList.filter((x) => x.status === "done").length;

  const byDay = useMemo(() => {
    const g = { 1: [], 2: [], 3: [], 4: [], 5: [], none: [] };
    for (const x of t.tasks) (x.day_of_week && g[x.day_of_week] ? g[x.day_of_week] : g.none).push(x);
    return g;
  }, [t.tasks]);

  async function add() {
    if (!newTitle.trim()) return;
    await t.update([...t.tasks, { title: newTitle.trim(), status: "todo", day_of_week: newDay }]);
    setNewTitle("");
    setNewDay(null);
    toast.push("Task added", "success");
  }

  if (t.error && t.tasks.length === 0 && !t.plan) return <ErrorBox msg={t.error} />;
  if (t.loading && !t.plan) return <Spinner />;

  return (
    <>
      <div className="proto-seg">
        <button className={view === "daily" ? "active" : ""} onClick={() => setView("daily")}>Daily</button>
        <button className={view === "weekly" ? "active" : ""} onClick={() => setView("weekly")}>Weekly</button>
      </div>

      {view === "daily" ? (
        <div className="proto-card">
          <div className="proto-card-title">
            Today
            <span className="proto-chip proto-chip-indigo">{todayDay ? DAYS[todayDay - 1].label : "No day set"}</span>
          </div>
          <div className="proto-progress" style={{ marginBottom: 8 }}>
            <div className="bar"><div style={{ width: `${todayList.length ? (doneToday / todayList.length) * 100 : 0}%` }} /></div>
            <span className="pct">{doneToday}/{todayList.length}</span>
          </div>
          {todayList.length === 0 ? (
            <div className="proto-empty"><span className="big">🗓</span>Nothing scheduled for today.</div>
          ) : (
            todayList.map((task) => (
              <div key={task.id} className={`proto-row ${task.status === "done" ? "done" : ""}`}
                onClick={() => t.toggle(task)}>
                <Check on={task.status === "done"} />
                <div className="proto-row-main"><div className="proto-row-title">{task.title}</div></div>
                <StatusSelect value={task.status} onChange={(s) => t.setStatus(task, s)} />
              </div>
            ))
          )}
          <AddBar
            value={newTitle}
            day={newDay ?? todayDay}
            onValue={setNewTitle}
            onDay={setNewDay}
            onAdd={add}
            weekdays
          />
        </div>
      ) : (
        <>
          <div className="proto-card">
            <div className="proto-card-title">This week <span className="proto-chip proto-chip-green">{t.tasks.filter((x) => x.status === "done").length}/{t.tasks.length} done</span></div>
            {DAYS.map((d) => {
              const list = byDay[d.value];
              return (
                <div key={d.value}>
                  <div className="proto-day-label" style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: ".06em", margin: "10px 2px 2px" }}>
                    {d.label} <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>{list.length}</span>
                  </div>
                  {list.length === 0 ? (
                    <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "4px 2px" }}>Nothing planned.</div>
                  ) : (
                    list.map((task) => (
                      <div key={task.id} className={`proto-row ${task.status === "done" ? "done" : ""}`}
                        onClick={() => t.toggle(task)}>
                        <Check on={task.status === "done"} />
                        <div className="proto-row-main"><div className="proto-row-title">{task.title}</div></div>
                        <StatusSelect value={task.status} onChange={(s) => t.setStatus(task, s)} />
                      </div>
                    ))
                  )}
                </div>
              );
            })}
            {byDay.none.length > 0 && (
              <div>
                <div className="proto-day-label" style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: ".06em", margin: "10px 2px 2px" }}>Unscheduled <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>{byDay.none.length}</span></div>
                {byDay.none.map((task) => (
                  <div key={task.id} className={`proto-row ${task.status === "done" ? "done" : ""}`}
                    onClick={() => t.toggle(task)}>
                    <Check on={task.status === "done"} />
                    <div className="proto-row-main"><div className="proto-row-title">{task.title}</div></div>
                    <StatusSelect value={task.status} onChange={(s) => t.setStatus(task, s)} />
                  </div>
                ))}
              </div>
            )}
          </div>
          <AddBar value={newTitle} day={newDay} onValue={setNewTitle} onDay={setNewDay} onAdd={add} weekdays label="Add this week" />
        </>
      )}
    </>
  );
}

function StatusSelect({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      style={{
        border: "1px solid var(--line-strong)",
        borderRadius: 999,
        background: "#fff",
        fontSize: 11,
        fontWeight: 600,
        padding: "6px 10px",
        color: "var(--text-dim)",
      }}
    >
      <option value="todo">To Do</option>
      <option value="in_progress">In progress</option>
      <option value="done">Done</option>
    </select>
  );
}

function AddBar({ value, day, onValue, onDay, onAdd, weekdays, label }) {
  return (
    <div className="proto-add">
      <input
        value={value}
        onChange={(e) => onValue(e.target.value)}
        placeholder={label || "Add a task…"}
        onKeyDown={(e) => e.key === "Enter" && onAdd()}
      />
      {weekdays && (
        <select value={day ?? ""} onChange={(e) => onDay(e.target.value ? Number(e.target.value) : null)}
          style={{ border: "1px solid var(--line-strong)", borderRadius: 14, padding: "0 8px", color: "var(--text-dim)" }}>
          <option value="">Any</option>
          {DAYS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
      )}
      <button className="proto-btn-icon" onClick={onAdd}><Icons.plus size={20} /></button>
    </div>
  );
}

/* --------------------------- Evaluations --------------------------- */

function useEvals() {
  const { user } = useAuth();
  const [state, setState] = useState({ loading: true, list: [], error: null });
  useEffect(() => {
    let alive = true;
    api.get("/me/evaluations")
      .then((list) => alive && setState({ loading: false, list, error: null }))
      .catch((err) => alive && setState((s) => ({ ...s, loading: false, error: err.message })));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.employee_id]);
  return state;
}

function EvaluationsTab({ openSheet }) {
  const { list, loading, error } = useEvals();
  if (error) return <ErrorBox msg={error} />;
  if (loading && !list.length) return <Spinner />;

  const todo = list.filter((e) => e.status === "draft" || e.status === "rejected");
  const done = list.filter((e) => !["draft", "rejected"].includes(e.status));

  return (
    <>
      <div className="proto-section-title">To do <span className="proto-chip proto-chip-indigo">{todo.length}</span></div>
      <div className="proto-card">
        {todo.length === 0 ? (
          <div className="proto-empty"><span className="big">✓</span>Nothing pending.</div>
        ) : (
          todo.map((e) => (
            <div key={e.id} className="proto-row" onClick={() => openSheet({ title: e.form_name, body: <EvalDetail e={e} /> })}>
              <div className="proto-row-main">
                <div className="proto-row-title">{evalTitle(e)}</div>
                <div className="proto-row-sub">{e.subject_name || "You"} · {e.cycle_name}</div>
              </div>
              <span className={`proto-chip proto-chip-${STATUS_CHIP[e.status] || "gray"}`}>{STATUS[e.status] || e.status}</span>
            </div>
          ))
        )}
      </div>

      {done.length > 0 && (
        <>
          <div className="proto-section-title">Archive</div>
          <div className="proto-card">
            {done.map((e) => (
              <div key={e.id} className="proto-row" onClick={() => openSheet({ title: e.form_name, body: <EvalDetail e={e} /> })}>
                <div className="proto-row-main">
                  <div className="proto-row-title">{evalTitle(e)}</div>
                  <div className="proto-row-sub">{e.cycle_name} · submitted</div>
                </div>
                <span className={`proto-chip proto-chip-${STATUS_CHIP[e.status] || "green"}`}>{STATUS[e.status] || e.status}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function EvalDetail({ e }) {
  const rows = [
    ["Form", e.form_name],
    ["Subject", e.subject_name || "You"],
    ["Your role", e.evaluator_type === "self" ? "Self review" : e.evaluator_type === "peer" ? "Peer" : "Manager"],
    ["Cycle", e.cycle_name],
    ["Status", STATUS[e.status] || e.status],
    e.due_date ? ["Due", e.due_date] : null,
    e.score != null ? ["Score", `${e.score}/100`] : null,
  ].filter(Boolean);
  return (
    <div>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid #f0f2f7", fontSize: 14 }}>
          <span style={{ color: "var(--text-dim)" }}>{k}</span>
          <span style={{ fontWeight: 600 }}>{v}</span>
        </div>
      ))}
      <div className="proto-note" style={{ marginTop: 14 }}>
        In the full app this opens the evaluation form so you can answer questions and submit. The prototype shows the assignment card only.
      </div>
    </div>
  );
}

/* ----------------------------- Score ----------------------------- */

function ScoreTab() {
  const { data, error } = useDashboard();
  if (error) return <ErrorBox msg={error} />;
  if (!data) return <Spinner />;

  const score = data.score;
  const benches = data.benchmarks || {};
  const results = data.evaluation_results || [];

  return (
    <>
      <div className="proto-hero">
        <div className="proto-ring-wrap">
          <Ring value={score?.overall_score} color={score?.rating?.color || "#8b9bf5"} />
        </div>
        <div className="proto-hero-meta">
          <div className="proto-hero-name">Your score</div>
          <div className="proto-hero-grade">
            <span className="grade-tag" style={{ background: score?.rating?.color || "var(--indigo)" }}>
              {score?.rating?.label || "Not scored yet"}
            </span>
          </div>
          <div className="proto-benches">
            <span className="proto-bench">Team <b>{benches.team_average ?? "—"}</b></span>
            <span className="proto-bench">Org <b>{benches.organization_average ?? "—"}</b></span>
          </div>
        </div>
      </div>

      <div className="proto-section-title">Performance</div>
      <div className="proto-card">
        <div className="proto-row">
          <div className="proto-row-main"><div className="proto-row-title">Overall score</div><div className="proto-row-sub">This cycle</div></div>
          <b className="mono" style={{ fontSize: 18 }}>{score?.overall_score != null ? score.overall_score : "—"}</b>
        </div>
        <div className="proto-row">
          <div className="proto-row-main"><div className="proto-row-title">Previous cycle</div><div className="proto-row-sub">Last recorded score</div></div>
          <b className="mono" style={{ fontSize: 18 }}>{data.previous_score != null ? data.previous_score : "—"}</b>
        </div>
        <div className="proto-row">
          <div className="proto-row-main"><div className="proto-row-title">Evaluations completed</div><div className="proto-row-sub">Across all perspectives</div></div>
          <b className="mono" style={{ fontSize: 18 }}>{results.length}</b>
        </div>
      </div>

      <div className="proto-section-title">History</div>
      <div className="proto-card">
        {!data.history || data.history.length === 0 ? (
          <div className="proto-empty"><span className="big">📈</span>No history yet.</div>
        ) : (
          data.history.map((h, i) => (
            <div key={i} className="proto-row">
              <div className="proto-row-main">
                <div className="proto-row-title">{h.cycle_name || h.cycle_id || "Cycle"}</div>
                <div className="proto-row-sub">{h.date || "recorded score"}</div>
              </div>
              <b className="mono" style={{ fontSize: 16 }}>{h.overall_score != null ? h.overall_score : "—"}</b>
              {h.rating_label && <span className={`proto-chip proto-chip-${STATUS_CHIP.scored}`}>{h.rating_label}</span>}
            </div>
          ))
        )}
      </div>
    </>
  );
}

/* ----------------------------- More ----------------------------- */

function MoreTab({ onSignOut }) {
  const { user } = useAuth();
  const { cycleId } = useCycle();
  const info = [
    ["Name", user.employee?.full_name || user.username],
    ["Position", user.employee?.position || "—"],
    ["Role", user.role],
    ["Username", user.username],
    ["Active cycle", cycleId ? `#${cycleId}` : "—"],
  ];
  return (
    <>
      <div className="proto-card">
        <div className="proto-card-title">Account</div>
        {info.map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid #f0f2f7", fontSize: 14 }}>
            <span style={{ color: "var(--text-dim)" }}>{k}</span>
            <span style={{ fontWeight: 600 }}>{v}</span>
          </div>
        ))}
      </div>

      <div className="proto-card">
        <div className="proto-card-title">App</div>
        <button className="proto-row" style={{ width: "100%", textAlign: "left" }} onClick={() => { window.location.href = "/"; }}>
          <div className="proto-row-main"><div className="proto-row-title">Open desktop app</div><div className="proto-row-sub">Full sidebar layout at /</div></div>
          <Icons.external size={16} style={{ color: "var(--text-faint)" }} />
        </button>
        <button className="proto-row" style={{ width: "100%", textAlign: "left" }} onClick={onSignOut}>
          <div className="proto-row-main"><div className="proto-row-title" style={{ color: "var(--crimson)" }}>Sign out</div></div>
          <Icons.logout size={16} style={{ color: "var(--crimson)" }} />
        </button>
      </div>

      <div className="proto-note">
        <b>Mobile user prototype.</b> A touch-first version of the desktop app focused on the everyday employee:
        weekly planning (daily + weekly), score, and reviews. It reuses the exact same API — log in with any account
        and the screens populate with real data.
      </div>
    </>
  );
}

/* ----------------------------- Sheet ----------------------------- */

function BottomSheet({ title, onClose, children }) {
  return (
    <div className="proto-sheet-backdrop" onClick={onClose}>
      <div className="proto-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="proto-sheet-head">
          <div className="proto-sheet-title">{title}</div>
          <button className="proto-btn-close" onClick={onClose}><Icons.close size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

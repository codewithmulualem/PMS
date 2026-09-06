import { useEffect, useMemo, useState } from "react";
import { Icons } from "../components/icons";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useCycle } from "../context/CycleContext";
import { useToast } from "../context/ToastContext";

/* Lightweight mobile screens for the rest of each role's navigation.
   Every screen reads from the same live API the desktop pages use. */

function initials(name = "") {
  return name.split(" ").filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join("");
}

function fmtTime(ts) {
  if (!ts) return "";
  const date = new Date((ts || "").replace(" ", "T") + "Z");
  if (Number.isNaN(date.getTime())) return ts;
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString();
}

function Chip({ tone = "gray", children }) {
  return <span className={`proto-chip proto-chip-${tone}`}>{children}</span>;
}

function Spin() {
  return <div className="proto-empty"><span className="big"><Icons.spinner size={26} /></span>Loading…</div>;
}

function ErrorBox({ msg }) {
  return <div className="proto-error">{msg}</div>;
}

function Section({ title, count, tone = "indigo" }) {
  return (
    <div className="proto-section-title">
      {title}
      {typeof count === "number" && count > 0 && <Chip tone={tone}>{count}</Chip>}
    </div>
  );
}

function Bar({ value }) {
  const v = Math.min(100, Math.max(0, value || 0));
  return (
    <div className="proto-progress" style={{ marginTop: 2 }}>
      <div className="bar"><div style={{ width: `${v}%` }} /></div>
    </div>
  );
}

function StatTile({ b, s }) {
  return <div className="proto-stat"><b>{b}</b><span>{s}</span></div>;
}

/* --------------------------- Executive overview --------------------------- */

export function ExecutiveTab() {
  const { cycleId } = useCycle();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api.get(`/executive/overview?cycle_id=${cycleId || ""}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [cycleId]);

  if (error) return <ErrorBox msg={error} />;
  if (!data) return <Spin />;

  const depts = (data.by_department || []).filter((d) => d.headcount > 0);
  const stats = [
    { b: data.organization_average_score != null ? Number(data.organization_average_score).toFixed(1) : "—", s: `${data.employees_scored ?? 0} scored` },
    { b: depts.length, s: "departments" },
    { b: (data.rating_distribution || []).length, s: "rating bands" },
  ];

  return (
    <>
      <div className="proto-stats">{stats.map((t, i) => <StatTile key={i} {...t} />)}</div>
      <Section title="Departments" count={depts.length} />
      <div className="proto-card">
        {depts.length === 0 ? (
          <div className="proto-empty"><span className="big">📊</span>No department data yet.</div>
        ) : (
          depts.map((d) => (
            <div key={d.department} style={{ padding: "4px 0" }}>
              <div className="proto-row" style={{ padding: "8px 0 4px" }}>
                <div className="proto-row-main">
                  <div className="proto-row-title">{d.department}</div>
                  <div className="proto-row-sub">{d.headcount} people</div>
                </div>
                <b className="mono" style={{ fontSize: 15 }}>{d.avg_score != null ? Number(d.avg_score).toFixed(1) : "—"}</b>
              </div>
              <Bar value={d.avg_score} />
            </div>
          ))
        )}
      </div>
    </>
  );
}

/* ------------------------------ Programs ------------------------------ */

const PROGRAM_TONE = { planning: "gray", in_progress: "indigo", on_hold: "warn", completed: "green" };

export function ProgramsTab({ openSheet }) {
  const { cycleId } = useCycle();
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get(`/programs${cycleId ? `?cycle_id=${cycleId}` : ""}`)
      .then((d) => alive && setList(d))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [cycleId]);

  function openDetail(p) {
    api.get(`/programs/${p.id}`)
      .then((d) => openSheet({ title: p.name, body: <ProgramDetail p={d} /> }))
      .catch((e) => openSheet({ title: p.name, body: <div className="proto-error">{e.message}</div> }));
  }

  if (error) return <ErrorBox msg={error} />;
  if (!list) return <Spin />;

  return (
    <>
      <Section title="Programs" count={list.length} />
      <div className="proto-card">
        {list.length === 0 ? (
          <div className="proto-empty"><span className="big">🗂</span>No programs in this cycle.</div>
        ) : (
          list.map((p) => (
            <div key={p.id} className="proto-row" onClick={() => openDetail(p)}>
              <div className="proto-row-main">
                <div className="proto-row-title">{p.name}</div>
                <div className="proto-row-sub">
                  {p.owner_name ? `Owner: ${p.owner_name} · ` : ""}{p.completed_activities ?? 0}/{p.activity_count ?? 0} activities
                </div>
              </div>
              <Chip tone={PROGRAM_TONE[p.status] || "gray"}>{p.status?.replace("_", " ")}</Chip>
              <Icons.chevronRight size={16} style={{ color: "var(--text-faint)" }} />
            </div>
          ))
        )}
      </div>
    </>
  );
}

function ProgramDetail({ p }) {
  const prog = p.program || p;
  const rows = [
    ["Status", prog.status || "—"],
    ["Owner", prog.owner_name || "—"],
    ["Cycle", prog.cycle_name || "—"],
    ["Activities", `${prog.completed_activities ?? 0} / ${prog.activity_count ?? 0} completed`],
  ].filter(([, v]) => v != null && v !== "—");
  return (
    <div>
      {prog.description && <div className="proto-note" style={{ margin: "0 0 12px" }}>{prog.description}</div>}
      {rows.map(([k, v]) => (
        <div key={k} className="proto-row" style={{ padding: "8px 0" }}>
          <div className="proto-row-main"><div className="proto-row-title">{k}</div></div>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

/* --------------------------- Strategic goals --------------------------- */

const SCOPE_LABEL = { annual: "Annual", quarterly: "Quarterly", team: "Team", department: "Department", individual: "Individual" };
const SCOPE_COLOR = { annual: "#4c5fd5", quarterly: "#0e8f7e", team: "#b17a17", department: "#7c5cd5", individual: "#5b6472" };
const GOAL_TONE = { draft: "gray", active: "indigo", completed: "green", cancelled: "red" };

export function StrategicGoalsTab() {
  const [goals, setGoals] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(new Set());

  useEffect(() => {
    let alive = true;
    api.get("/strategic-goals/tree")
      .then((d) => {
        if (!alive) return;
        setGoals(d);
        setExpanded(new Set(d.map((g) => g.id)));
      })
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, []);

  function toggle(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (error) return <ErrorBox msg={error} />;
  if (!goals) return <Spin />;

  return (
    <>
      <Section title="Strategic goals" count={goals.length} />
      <div className="proto-card">
        {goals.length === 0 ? (
          <div className="proto-empty"><span className="big">🎯</span>No strategic goals yet.</div>
        ) : (
          goals.map((g) => <GoalRow key={g.id} g={g} depth={0} expanded={expanded} toggle={toggle} />)
        )}
      </div>
    </>
  );
}

function GoalRow({ g, depth, expanded, toggle }) {
  const hasChildren = g.children && g.children.length > 0;
  const open = expanded.has(g.id);
  const color = SCOPE_COLOR[g.scope] || "#4c5fd5";
  return (
    <div>
      <div className="proto-row" style={{ borderLeft: `3px solid ${color}`, paddingLeft: 10 }}>
        {hasChildren ? (
          <button className="proto-tree-toggle" onClick={() => toggle(g.id)} aria-label="Expand">{open ? "▾" : "▸"}</button>
        ) : (
          <span className="proto-tree-toggle" />
        )}
        <div className="proto-row-main">
          <div className="proto-row-title">{g.title}</div>
          <div className="proto-row-sub">
            {g.org_unit_name && <span>{g.org_unit_name} · </span>}
            {g.owner_name && <span>{g.owner_name}{g.assigned_name ? ` → ${g.assigned_name}` : ""}</span>}
          </div>
        </div>
        <span className="proto-chip" style={{ background: `${color}22`, color }}>
          {SCOPE_LABEL[g.scope] || g.scope}
        </span>
        <b className="mono" style={{ fontSize: 13 }}>{g.progress_pct ?? 0}%</b>
      </div>
      {hasChildren && open && (
        <div style={{ marginTop: 2 }}>
          {g.children.map((c) => <GoalRow key={c.id} g={c} depth={depth + 1} expanded={expanded} toggle={toggle} />)}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Approvals ------------------------------ */

const APPROVER_LABEL = { 1: "immediate manager", 2: "manager's manager", 3: "third level" };

export function ApprovalsTab({ openSheet }) {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    try {
      setError(null);
      setList(await api.get("/approvals/pending"));
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function decide(item, decision, comments) {
    try {
      const res = await api.post(`/evaluations/${item.id}/decision`, { decision, comments });
      toast.push(
        decision === "approve"
          ? res.status === "scored" ? "Approved — final score computed" : "Approved"
          : "Returned to the employee for revision",
        "success",
      );
      setList(null);
      load();
    } catch (e) {
      toast.push(e.message, "error");
    }
  }

  if (error) return <ErrorBox msg={error} />;
  if (!list) return <Spin />;

  return (
    <>
      <Section title="Awaiting your review" count={list.length} tone="warn" />
      <div className="proto-card">
        {list.length === 0 ? (
          <div className="proto-empty"><span className="big">✓</span>Nothing awaiting your approval.</div>
        ) : (
          list.map((a) => (
            <div key={a.id} className="proto-row" onClick={() => openSheet({ title: a.form_name, body: <ApprovalDetail a={a} onDecide={decide} /> })}>
              <div className="proto-avatar-sm">{initials(a.subject_name || "?")}</div>
              <div className="proto-row-main">
                <div className="proto-row-title">{a.subject_name}</div>
                <div className="proto-row-sub">{a.form_name} · {a.cycle_name}</div>
              </div>
              <span className="mono" style={{ fontSize: 12, color: "var(--text-dim)" }}>L{a.next_level}</span>
              <Icons.chevronRight size={16} style={{ color: "var(--text-faint)" }} />
            </div>
          ))
        )}
      </div>
    </>
  );
}

function ApprovalDetail({ a, onDecide }) {
  const [decision, setDecision] = useState(null);
  const [comments, setComments] = useState("");
  const [working, setWorking] = useState(false);

  async function submit() {
    if (!comments.trim()) return;
    setWorking(true);
    try {
      await onDecide(a, decision, comments.trim());
      setDecision(null);
      setComments("");
    } finally {
      setWorking(false);
    }
  }

  const rows = [
    ["Employee", a.subject_name],
    ["Form", a.form_name],
    ["Cycle", a.cycle_name],
    ["Level", `L${a.next_level} ${APPROVER_LABEL[a.next_level] || ""}`],
    ["Evaluator", a.evaluator_name ? `${a.evaluator_name} (${a.evaluator_type})` : a.evaluator_type],
  ].filter(([, v]) => v);

  return (
    <div>
      {rows.map(([k, v]) => (
        <div key={k} className="proto-row" style={{ padding: "8px 0" }}>
          <div className="proto-row-main"><div className="proto-row-title" style={{ color: "var(--text-dim)" }}>{k}</div></div>
          <span style={{ fontWeight: 600, fontSize: 13, textAlign: "right" }}>{v}</span>
        </div>
      ))}
      {!decision ? (
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className="proto-action-btn red" onClick={() => setDecision("reject")}>Return for revision</button>
          <button className="proto-action-btn green" onClick={() => setDecision("approve")}>Approve</button>
        </div>
      ) : (
        <div className="proto-approve-form">
          <textarea
            className="proto-textarea"
            rows={3}
            autoFocus
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder={decision === "approve" ? "Comments for this approval…" : "Reason for returning to the employee…"}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="proto-action-btn" disabled={working} onClick={() => setDecision(null)}>Back</button>
            <button className={`proto-action-btn ${decision === "approve" ? "green" : "red"}`} disabled={working || !comments.trim()} onClick={submit}>
              {working ? "Working…" : decision === "approve" ? "Confirm approval" : "Confirm return"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- My Team ------------------------------- */

export function TeamTab() {
  const { user } = useAuth();
  const { cycleId } = useCycle();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    api.get(`/managers/${user.employee_id}/team-dashboard?cycle_id=${cycleId || ""}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [user?.employee_id, cycleId]);

  if (error) return <ErrorBox msg={error} />;
  if (!data) return <Spin />;

  const members = data.team || [];
  const stats = [
    { b: data.average_score != null ? data.average_score.toFixed(1) : "—", s: "team average" },
    { b: data.evaluations_pending ?? 0, s: "evals pending" },
    { b: (data.high_performers || []).length, s: "high performers" },
    { b: (data.employees_needing_attention || []).length, s: "need attention" },
  ];

  return (
    <>
      <div className="proto-stats">{stats.map((t, i) => <StatTile key={i} {...t} />)}</div>
      <Section title="Direct reports" count={members.length} tone="green" />
      <div className="proto-card">
        {members.length === 0 ? (
          <div className="proto-empty"><span className="big">👥</span>No direct reports assigned yet.</div>
        ) : (
          members.map((m) => (
            <div key={m.employee.id || m.employee_id} className="proto-row">
              <div className="proto-avatar-sm">{initials((m.employee?.full_name) || m.full_name || "?")}</div>
              <div className="proto-row-main">
                <div className="proto-row-title">{m.employee?.full_name || m.full_name}</div>
                <div className="proto-row-sub">{m.employee?.position || "Team member"}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div><b className="mono">{m.overall_score != null ? m.overall_score.toFixed(1) : "—"}</b></div>
                <div style={{ marginTop: 2 }}>
                  {m.at_risk_goals > 0
                    ? <Chip tone="red">{m.at_risk_goals} at risk</Chip>
                    : <Chip tone="green">on track</Chip>}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

/* ------------------- Directorate / Department / Team plans ------------------- */

export function DirectoratePlansTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get("/tiers/overview")
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, []);

  if (error) return <ErrorBox msg={error} />;
  if (!data) return <Spin />;

  const tree = data.tree;
  const nodes = tree.children || [];

  return (
    <>
      <Section title={`Your scope · week of ${data.week_start}`} />
      <div className="proto-card">
        {nodes.length === 0 ? (
          <div className="proto-empty"><span className="big">🗂</span>No units under your scope yet.</div>
        ) : (
          nodes.map((n) => (
            <div key={n.unit_id} style={{ padding: "4px 0" }}>
              <div className="proto-row" style={{ padding: "8px 0 4px" }}>
                <div className="proto-row-main">
                  <div className="proto-row-title">{n.name}</div>
                  <div className="proto-row-sub">
                    {n.member_count} people{n.total_tasks > 0 ? ` · ${n.done_tasks}/${n.total_tasks} tasks` : ""}
                  </div>
                </div>
                <b className="mono" style={{ fontSize: 15 }}>{n.completion_pct ?? 0}%</b>
              </div>
              <Bar value={n.completion_pct} />
            </div>
          ))
        )}
      </div>
    </>
  );
}

export function DepartmentPlansTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get("/strategic-goals/department")
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, []);

  if (error) return <ErrorBox msg={error} />;
  if (!data) return <Spin />;

  const qs = data.quarterlies || [];
  const teams = data.teams || [];

  return (
    <>
      {qs.map((q) => <Chip key={q.id} tone="indigo">{q.title} · {q.quarter} {q.year}</Chip>)}
      <div style={{ height: 10 }} />
      <Section title="Team work plans" count={teams.length} tone="green" />
      {teams.length === 0 ? (
        <div className="proto-card"><div className="proto-empty"><span className="big">🗂</span>No teams under your department.</div></div>
      ) : (
        teams.map((team) => (
          <div key={team.unit_id} className="proto-card">
            <div className="proto-card-title">{team.unit_name} <span className="proto-chip proto-chip-gray">{team.plans.length} plan{team.plans.length === 1 ? "" : "s"}</span></div>
            {team.plans.length === 0 ? (
              <div className="proto-empty"><span className="big">📝</span>No work plan assigned yet.</div>
            ) : (
              team.plans.map((p) => (
                <div key={p.id} className="proto-row">
                  <div className="proto-row-main">
                    <div className="proto-row-title">{p.title}</div>
                    <div className="proto-row-sub">{p.tasks_assigned ?? 0} tasks</div>
                  </div>
                  <span className={`proto-chip proto-chip-${GOAL_TONE[p.status] || "gray"}`}>{p.status}</span>
                  <b className="mono" style={{ fontSize: 13 }}>{p.progress_pct ?? 0}%</b>
                </div>
              ))
            )}
          </div>
        ))
      )}
    </>
  );
}

export function TeamPlansTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get("/strategic-goals/team")
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, []);

  if (error) return <ErrorBox msg={error} />;
  if (!data) return <Spin />;

  const plans = data.plans || [];
  const anchors = data.anchors || [];
  const members = data.members || [];

  return (
    <>
      <Section title="Assigned plan" count={plans.length} tone="green" />
      {plans.length === 0 ? (
        <div className="proto-card"><div className="proto-empty"><span className="big">📝</span>No plan assigned to your team yet.</div></div>
      ) : (
        plans.map((plan, idx) => (
          <div key={plan.id} className="proto-card">
            <div className="proto-card-title">{plan.title}
              <span className={`proto-chip proto-chip-${GOAL_TONE[plan.status] || "gray"}`}>{plan.status}</span>
            </div>
            {(anchors[idx] || []).length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {(anchors[idx] || []).map((a) => <Chip key={a.id} tone="gray">{a.title}</Chip>)}
              </div>
            )}
            <Bar value={(plan.progress_pct ?? 0)} />
          </div>
        ))
      )}

      <Section title="Member tasks" count={members.length} tone="indigo" />
      <div className="proto-card">
        {members.length === 0 ? (
          <div className="proto-empty"><span className="big">👥</span>No members on this team.</div>
        ) : (
          members.map((m) => {
            const mTasks = m.tasks || [];
            const mDone = mTasks.filter((t) => t.status === "done").length;
            return (
              <div key={m.id} className="proto-row" style={{ alignItems: "flex-start" }}>
                <div className="proto-avatar-sm">{initials(m.full_name || "?")}</div>
                <div className="proto-row-main">
                  <div className="proto-row-title">{m.full_name}
                    <span className="proto-chip proto-chip-gray" style={{ marginLeft: 6 }}>{mTasks.length ? `${mDone}/${mTasks.length} done` : "no tasks"}</span>
                  </div>
                  {mTasks.length === 0 ? (
                    <div className="proto-row-sub">No tasks yet.</div>
                  ) : (
                    mTasks.map((t) => (
                      <div key={t.id} className="proto-row" style={{ padding: "5px 0" }}>
                        <div className="proto-row-main"><div className="proto-row-title" style={{ fontSize: 13 }}>{t.title}</div></div>
                        <span className="proto-chip proto-chip-gray" style={{ fontSize: 10 }}>{t.status?.replace("_", " ")}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>{t.progress_pct}%</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

/* ------------------------------ Peer reviews ------------------------------ */

export function PeerReviewsTab({ openSheet }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get("/me/evaluations")
      .then((d) => alive && setList(d.filter((e) => e.evaluator_type === "peer")))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, []);

  if (error) return <ErrorBox msg={error} />;
  if (!list) return <Spin />;

  const open = list.filter((e) => e.status === "draft" || e.status === "rejected");
  const done = list.filter((e) => !["draft", "rejected"].includes(e.status));

  const sheet = (e) => openSheet({
    title: e.form_name,
    body: (
      <div>
        {[["Colleague", e.subject_name], ["Cycle", e.cycle_name || "—"], ["Status", e.status || "—"], e.due_date ? ["Due", e.due_date] : null, e.score != null ? ["Score", `${e.score}/100`] : null]
          .filter(Boolean)
          .map(([k, v]) => (
            <div key={k} className="proto-row" style={{ padding: "8px 0" }}>
              <div className="proto-row-main"><div className="proto-row-title" style={{ color: "var(--text-dim)" }}>{k}</div></div>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{v}</span>
            </div>
          ))}
        <div className="proto-note" style={{ marginTop: 12 }}>
          In the full app this opens the peer-review form so you can score your colleague and submit. The prototype shows the assignment card only.
        </div>
      </div>
    ),
  });

  return (
    <>
      <Section title="To do" count={open.length} tone="warn" />
      <div className="proto-card">
        {open.length === 0 ? (
          <div className="proto-empty"><span className="big">✓</span>No peer reviews pending.</div>
        ) : (
          open.map((e) => (
            <div key={e.id} className="proto-row" onClick={() => sheet(e)}>
              <div className="proto-avatar-sm">{initials(e.subject_name || "?")}</div>
              <div className="proto-row-main">
                <div className="proto-row-title">{e.subject_name}</div>
                <div className="proto-row-sub">{e.cycle_name}</div>
              </div>
              <Icons.chevronRight size={16} style={{ color: "var(--text-faint)" }} />
            </div>
          ))
        )}
      </div>
      {done.length > 0 && (
        <>
          <Section title="Archive" count={done.length} tone="gray" />
          <div className="proto-card">
            {done.map((e) => (
              <div key={e.id} className="proto-row" onClick={() => sheet(e)}>
                <div className="proto-avatar-sm">{initials(e.subject_name || "?")}</div>
                <div className="proto-row-main">
                  <div className="proto-row-title">{e.subject_name}</div>
                  <div className="proto-row-sub">{e.cycle_name}</div>
                </div>
                <Chip tone="green">submitted</Chip>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/* ------------------------------ Employees ------------------------------ */

export function EmployeesTab() {
  const [emps, setEmps] = useState(null);
  const [depts, setDepts] = useState([]);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    Promise.all([api.get("/employees"), api.get("/departments").catch(() => [])])
      .then(([e, d]) => {
        if (!alive) return;
        setEmps(e);
        setDepts(d || []);
      })
      .catch((err) => alive && setError(err.message));
    return () => { alive = false; };
  }, []);

  const deptName = useMemo(() => {
    const m = {};
    for (const d of depts) m[d.id] = d.name;
    return m;
  }, [depts]);

  if (error) return <ErrorBox msg={error} />;
  if (!emps) return <Spin />;

  const filtered = emps.filter(
    (e) => !q || (e.full_name || "").toLowerCase().includes(q.toLowerCase()) || (e.position || "").toLowerCase().includes(q.toLowerCase())
  );
  const active = filtered.filter((e) => e.employment_status !== "resigned" && e.employment_status !== "terminated");

  return (
    <>
      <input
        className="proto-input"
        placeholder="Search people…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div style={{ height: 6 }} />
      <Section title="People" count={active.length} tone="green" />
      <div className="proto-card">
        {active.length === 0 ? (
          <div className="proto-empty"><span className="big">👥</span>No people match your search.</div>
        ) : (
          active.map((e) => (
            <div key={e.id} className="proto-row">
              <div className="proto-avatar-sm">{initials(e.full_name || "?")}</div>
              <div className="proto-row-main">
                <div className="proto-row-title">{e.full_name}</div>
                <div className="proto-row-sub">{e.position || "—"}{deptName[e.department_id] ? ` · ${deptName[e.department_id]}` : ""}</div>
              </div>
              {e.role && <Chip tone="gray">{e.role}</Chip>}
              {e.employment_status && e.employment_status !== "active" && <Chip tone="warn">{e.employment_status}</Chip>}
            </div>
          ))
        )}
      </div>
    </>
  );
}

/* ---------------------------- Organization setup ---------------------------- */

export function OrganizationTab() {
  const [cycles, setCycles] = useState(null);
  const [comp, setComp] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([api.get("/cycles"), api.get("/competencies")])
      .then(([c, co]) => {
        if (!alive) return;
        setCycles(c);
        setComp(co);
      })
      .catch((err) => alive && setError(err.message));
    return () => { alive = false; };
  }, []);

  if (error) return <ErrorBox msg={error} />;
  if (!cycles || !comp) return <Spin />;

  const cycleTone = { active: "green", closed: "gray", planned: "indigo" };

  return (
    <>
      <Section title="Performance cycles" count={cycles.length} />
      <div className="proto-card">
        {cycles.length === 0 ? (
          <div className="proto-empty"><span className="big">🗓</span>No cycles created yet.</div>
        ) : (
          cycles.map((c) => (
            <div key={c.id} className="proto-row">
              <div className="proto-row-main">
                <div className="proto-row-title">{c.name}</div>
                <div className="proto-row-sub mono">{c.start_date} → {c.end_date || "—"}</div>
              </div>
              <Chip tone={cycleTone[c.status] || "gray"}>{c.status}</Chip>
            </div>
          ))
        )}
      </div>

      <Section title="Competency framework" count={comp.length} tone="green" />
      <div className="proto-card">
        {comp.length === 0 ? (
          <div className="proto-empty"><span className="big">⭐</span>No competencies defined yet.</div>
        ) : (
          comp.map((c) => (
            <div key={c.id} className="proto-row">
              <div className="proto-row-main">
                <div className="proto-row-title">{c.name}</div>
                <div className="proto-row-sub">{c.category || "—"}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

/* ----------------------------- Evaluation forms ----------------------------- */

export function FormsTab() {
  const [forms, setForms] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get("/evaluation-forms")
      .then((d) => alive && setForms(d))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, []);

  if (error) return <ErrorBox msg={error} />;
  if (!forms) return <Spin />;

  return (
    <>
      <Section title="Form templates" count={forms.length} />
      <div className="proto-card">
        {forms.length === 0 ? (
          <div className="proto-empty"><span className="big">🗒</span>No evaluation forms yet.</div>
        ) : (
          forms.map((f) => (
            <div key={f.id} className="proto-row">
              <div className="proto-row-main">
                <div className="proto-row-title">{f.name}</div>
                <div className="proto-row-sub">{f.description || `Sections ${f.section_count ?? 0} · Questions ${f.question_count ?? 0}`}</div>
              </div>
              {f.active ? <Chip tone="green">active</Chip> : <Chip tone="gray">archived</Chip>}
            </div>
          ))
        )}
      </div>
    </>
  );
}

/* ------------------------------- AI anomalies ------------------------------- */

export function AnomaliesTab() {
  const { cycleId } = useCycle();
  const [signals, setSignals] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!cycleId) { setSignals([]); return; }
    let alive = true;
    setSignals(null);
    api.get(`/ai/anomalies?cycle_id=${cycleId}`)
      .then((d) => alive && setSignals(d))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [cycleId]);

  if (error) return <ErrorBox msg={error} />;

  return (
    <>
      <div className="proto-card" style={{ borderLeft: "3px solid var(--amber)" }}>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <b>AI is advisory, never decisive.</b> Signals are statistical patterns that <em>may</em> warrant attention —
          they never change a score. Investigate and act as a human decision-maker.
        </div>
      </div>
      {!cycleId ? (
        <div className="proto-card"><div className="proto-empty"><span className="big">🔍</span>Select a cycle to scan for signals.</div></div>
      ) : !signals ? (
        <Spin />
      ) : (
        <>
          <Section title="Detected signals" count={signals.length} tone="warn" />
          <div className="proto-card">
            {signals.length === 0 ? (
              <div className="proto-empty"><span className="big">✓</span>No anomaly signals in this cycle.</div>
            ) : (
              signals.map((s, i) => (
                <div key={i} className="proto-row" style={{ alignItems: "flex-start" }}>
                  <div className="proto-row-main">
                    <div className="proto-row-title">
                      <span className="proto-chip proto-chip-red" style={{ marginRight: 6 }}>signal</span>
                      {s.titles?.join(", ") || s.title || "Pattern"}
                    </div>
                    <div className="proto-row-sub">{s.content}</div>
                    {s.supporting_data && (
                      <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>
                        {JSON.stringify(s.supporting_data)}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </>
  );
}

/* -------------------------------- Audit log -------------------------------- */

const ACTION_TONE = { create: "green", update: "indigo", delete: "red", login: "indigo", logout: "gray", recalculate: "warn", calculated: "warn" };

export function AuditTab() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get("/audit?limit=30")
      .then((d) => alive && setEvents(d))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, []);

  if (error) return <ErrorBox msg={error} />;
  if (!events) return <Spin />;

  return (
    <>
      <Section title="Recent events" count={events.length} tone="gray" />
      <div className="proto-card">
        {events.length === 0 ? (
          <div className="proto-empty"><span className="big">🕐</span>No audit events recorded yet.</div>
        ) : (
          events.map((ev) => (
            <div key={`${ev.timestamp}-${ev.id}`} className="proto-row" style={{ alignItems: "flex-start" }}>
              <span className="proto-dot-marker" style={{ background: ev.action === "delete" ? "var(--crimson)" : ev.action === "create" ? "var(--green)" : "var(--indigo)" }} />
              <div className="proto-row-main">
                <div className="proto-row-title" style={{ textTransform: "capitalize" }}>
                  {ev.entity_type} <span className="proto-chip proto-chip-gray" style={{ fontSize: 10 }}>{ev.action}</span>
                  {ev.changed_by && <span style={{ color: "var(--text-faint)", fontWeight: 400 }}> · by {ev.changed_by}</span>}
                </div>
                {ev.new_value != null && <div className="proto-row-sub mono">+ {typeof ev.new_value === "string" && ev.new_value.length > 160 ? ev.new_value.slice(0, 157) + "…" : JSON.stringify(ev.new_value)}</div>}
              </div>
              <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)", whiteSpace: "nowrap" }}>{fmtTime(ev.timestamp)}</span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
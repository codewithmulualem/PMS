import { useEffect, useState } from "react";
import { api } from "../api";
import { useToast } from "../context/ToastContext";
import Modal from "../components/Modal";
import Skeleton from "../components/Skeleton";
import { Icons } from "../components/icons";
import PlanPerformanceTable from "./PlanPerformance";
import { statusLabel } from "../i18n";

const PLAN_STATUS = {
  draft: "chip chip-neutral",
  active: "chip chip-indigo",
  completed: "chip chip-success",
  cancelled: "chip chip-neutral",
};
const GOAL_STATUSES = ["draft", "active", "completed"];
const ACTIVITY_STATUSES = ["not_started", "in_progress", "on_hold", "completed"];
const ACTIVITY_STATUS_LABELS = { not_started: "አልተጀመረም", in_progress: "በሂደት ላይ", on_hold: "ቆሟል", completed: "ተጠናቋል" };
const DAY_NAMES = { 1: "ሰኞ", 2: "ማክሰኞ", 3: "ረቡዕ", 4: "ሐሙስ", 5: "ዓርብ" };

export default function DepartmentPlans() {
  const toast = useToast();
  const [planning, setPlanning] = useState(null);
  const [planError, setPlanError] = useState(null);
  const [anchorFor, setAnchorFor] = useState(null);
  const [quarterlyForm, setQuarterlyForm] = useState(false);
  const [editingGoal, setEditingGoal] = useState(null);
  const [addingActivityFor, setAddingActivityFor] = useState(null);
  const [editingActivity, setEditingActivity] = useState(null);
  const [saving, setSaving] = useState(false);
  const [week, setWeek] = useState(null);
  const [weekError, setWeekError] = useState(null);
  const [openWeeks, setOpenWeeks] = useState({});
  const [authorWeekFor, setAuthorWeekFor] = useState(null);

  async function loadPlanning() {
    try {
      setPlanError(null);
      const data = await api.get("/strategic-goals/department");
      setPlanning(data);
    } catch (err) {
      setPlanError(err.message);
    }
  }

  async function loadWeekly() {
    try {
      setWeekError(null);
      const data = await api.get("/weekly-plans/plan-performance");
      setWeek(data);
    } catch (err) {
      setWeekError(err.message);
    }
  }

  useEffect(() => {
    loadPlanning();
    loadWeekly();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function synthesize(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const title = (fd.get("title") || "").trim();
    if (!title) return;
    setSaving(true);
    try {
      await api.post(`/strategic-goals/${anchorFor.quarterly_id}/assign`, {
        assignments: [
          {
            title,
            description: (fd.get("description") || "").trim() || undefined,
            org_unit_id: anchorFor.unit_id,
          },
        ],
      });
      toast.push(`ዕቅዱ ለ${anchorFor.unit_name} ተመድቧል`, "success");
      setAnchorFor(null);
      loadPlanning();
    } catch (err) {
      toast.push(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  const owned = (goal) => goal && goal.owner_id !== undefined;

  return (
    <div className="page-enter">
      {/* ── Quarterly Planning: author anchors + assign one work plan per team ── */}
      <div className="card">
        <div className="card-title">
          የሩብ ዓመት ዕቅድ
          <span className="chip chip-neutral">የመምሪያ ኃላፊ</span>
        </div>
        <div className="card-sub">
          የመምሪያዎን የሩብ ዓመት መነሻ ዕቅዶች ያዘጋጁ እና ለእያንዳንዱ ቡድን ወደ አንድ የሥራ ዕቅድ ያውርዷቸው።
        </div>

        {planning === null && !planError ? (
          <Skeleton lines={6} height={18} />
        ) : planError ? (
          <div className="error-banner">{planError}</div>
        ) : (
          <div style={{ marginTop: 4 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--text-dim)", alignSelf: "center" }}>መነሻዎች፦</span>
              {planning.quarterlies.map((q) => (
                <span key={q.id} className="chip chip-indigo" style={{ fontSize: 11 }}>
                  {q.title} · {q.quarter || "—"} {q.year}
                </span>
              ))}
              <button
                className="btn btn-secondary btn-sm"
                style={{ marginLeft: "auto" }}
                onClick={() => setQuarterlyForm(true)}
                title="ለአንዱ ቡድንዎ አዲስ የሩብ ዓመት ዕቅድ ያዘጋጁ"
              >
                <Icons.plus size={13} /> አዲስ የሩብ ዓመት ዕቅድ
              </button>
            </div>

            {planning.teams.map((team) => (
              <div key={team.unit_id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, marginBottom: 10 }}>
                <div className="flex-between">
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{team.unit_name}</div>
                  <span className="chip chip-neutral" style={{ fontSize: 11 }}>
                    {team.plans.length} ዕቅድ
                  </span>
                </div>

                {team.quarterly_plans.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", marginBottom: 4 }}>
                      የሩብ ዓመት መነሻዎች
                    </div>
                    {team.quarterly_plans.map((q) => (
                      <PlanRow key={q.id} goal={q} owned={owned(q)} onEdit={() => setEditingGoal(q)} />
                    ))}
                  </div>
                )}

                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", marginBottom: 4 }}>
                      የሥራ ዕቅዶች
                  </div>
                  {team.plans.length === 0 ? (
                    <div style={{ fontSize: 13, color: "var(--text-faint)", fontStyle: "italic" }}>
                      እስካሁን የሥራ ዕቅድ አልተመደበም።
                    </div>
                  ) : (
                    team.plans.map((p) => <PlanRow key={p.id} goal={p} owned={owned(p)} onEdit={() => setEditingGoal(p)} />)
                  )}
                </div>

                <button
                  className="btn btn-secondary btn-sm"
                  style={{ marginTop: 10, marginRight: 8 }}
                  disabled={team.plans.length > 0 || planning.quarterlies.length === 0}
                  title={
                    planning.quarterlies.length === 0
                      ? "ምንም የሩብ ዓመት መነሻ የለም"
                      : team.plans.length > 0
                      ? "ይህ ቡድን በዚህ ሩብ ዓመት ዕቅድ አለው"
                      : "ለዚህ ቡድን የሥራ ዕቅድ ይመድቡ"
                  }
                  onClick={() =>
                    setAnchorFor({
                      quarterly_id: planning.quarterlies[0].id,
                      unit_id: team.unit_id,
                      unit_name: team.unit_name,
                    })
                  }
                >
                  <Icons.plus size={13} />
                  {team.plans.length > 0 ? "ዕቅድ ተመድቧል" : "የቡድን ዕቅድ አዘጋጅ"}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ marginTop: 10 }}
                  onClick={() => setAddingActivityFor(team)}
                >
                  <Icons.plus size={13} /> ተግባር ጨምር
                </button>

                {team.activities && team.activities.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", marginBottom: 6 }}>
                      ተግባራት
                    </div>
                    {team.activities.map((a) => (
                      <div key={a.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, marginBottom: 8, background: "var(--neutral-bg)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{a.title}</span>
                          <span className="chip chip-neutral" style={{ fontSize: 10 }}>
                            {a.member_task_count} የአባል ተግባር
                          </span>
                          {a.program_name && (
                            <span className="chip chip-indigo" style={{ fontSize: 10 }}>{a.program_name}</span>
                          )}
                          {a.strategic_goal_title && (
                            <span className="chip chip-neutral" style={{ fontSize: 10 }}>የሚያገለግለው፦ {a.strategic_goal_title}</span>
                          )}
                          <span className={PLAN_STATUS[a.status] || "chip chip-neutral"} style={{ fontSize: 10 }}>{statusLabel(a.status)}</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>{a.progress_pct}%</span>
                          <button className="btn btn-sm" title="ተግባር አርትዕ" onClick={() => setEditingActivity({ activity: a, team })}>
                            <Icons.edit size={13} />
                          </button>
                        </div>
                        {a.kpis.length > 0 && (
                          <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {a.kpis.map((k) => (
                              <span key={k.id} className="chip chip-neutral" style={{ fontSize: 10 }} title={`${k.name} — ዒላማ ${k.target_value ?? "—"}፣ ትክክለኛ ${k.actual_value ?? "—"}`}>
                                {k.name}: {k.actual_value ?? "—"}/{k.target_value ?? "—"}
                              </span>
                            ))}
                          </div>
                        )}
                        {a.children.length > 0 && (
                          <div style={{ marginTop: 6, borderTop: "1px dashed var(--line)", paddingTop: 6 }}>
                            {a.children.map((c) => (
                              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "3px 0" }}>
                                <Icons.chevronRight size={12} />
                                <span style={{ flex: 1 }}>{c.title}</span>
                                <span className={PLAN_STATUS[c.status] || "chip chip-neutral"} style={{ fontSize: 9 }}>{statusLabel(c.status)}</span>
                                <span style={{ flex: 1, textAlign: "right", fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>{c.progress_pct}%</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {planning.teams.length === 0 && (
              <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
                በመምሪያዎ ስር እስካሁን የቡድን ደረጃ ክፍሎች የሉም።
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Weekly Execution: dept head authors/reviews the leaders' weeks ── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">
          ሳምንታዊ አፈጻጸም
          <span className="chip chip-neutral">ይህ ሳምንት</span>
        </div>
        <div className="card-sub">
          የቡድን መሪዎችዎን እና የአባላቶቻቸውን ሳምንታዊ ዕቅድ ያዘጋጁ እና ይገምግሙ።
        </div>

        {week === null && !weekError ? (
          <Skeleton lines={4} height={20} />
        ) : weekError ? (
          <div className="error-banner">{weekError}</div>
        ) : week.summaries.length === 0 ? (
          <div style={{ padding: "10px 0", fontSize: 13, color: "var(--text-dim)" }}>
            በመምሪያዎ ስር ንቁ ሰራተኞች የሉም።
          </div>
        ) : (
          <div style={{ marginTop: 8 }}>
            {week.summaries.map((emp) => (
              <div key={emp.employee_id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{emp.full_name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                      {emp.position || "የቡድን አባል"} · {emp.done_tasks}/{emp.total_tasks} ተጠናቋል
                    </div>
                  </div>
                  <div style={{ width: 120 }}>
                    <div style={{ height: 8, background: "var(--neutral-bg)", borderRadius: 999, overflow: "hidden" }}>
                      <div style={{ width: `${emp.completion_pct}%`, height: "100%", background: "var(--indigo)", borderRadius: 999 }} />
                    </div>
                  </div>
                  <span className="chip chip-success" style={{ fontSize: 11 }}>{emp.completion_pct}%</span>
                  <button
                    className="btn btn-sm"
                    title={openWeeks[emp.employee_id] ? "ደብቅ" : "ተግባራትን አሳይ"}
                    onClick={() => setOpenWeeks((o) => ({ ...o, [emp.employee_id]: !o[emp.employee_id] }))}
                  >
                    {openWeeks[emp.employee_id] ? <Icons.chevronDown size={13} /> : <Icons.chevronRight size={13} />}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setAuthorWeekFor(emp)}>
                    <Icons.edit size={13} /> ሳምንታዊ ዕቅድ አዘጋጅ
                  </button>
                </div>
                {openWeeks[emp.employee_id] && (
                  <div style={{ marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
                    {emp.tasks.length === 0 ? (
                    <div style={{ fontSize: 12, color: "var(--text-faint)", fontStyle: "italic" }}>እስካሁን ሳምንታዊ ዕቅድ አልተዘጋጀም።</div>
                    ) : (
                      emp.tasks.map((t) => (
                        <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13 }}>
                          <span style={{ flex: 1, color: t.status === "done" ? "var(--text-dim)" : "var(--text)", textDecoration: t.status === "done" ? "line-through" : "none" }}>
                            {t.title}
                          </span>
                          {t.day_of_week && <span className="chip chip-neutral" style={{ fontSize: 10 }}>{DAY_NAMES[t.day_of_week]}</span>}
                          {t.strategic_goal_title && <span className="chip chip-indigo" style={{ fontSize: 10 }}>{t.strategic_goal_title}</span>}
                          <span className={PLAN_STATUS[t.status] || "chip chip-neutral"} style={{ fontSize: 10 }}>{statusLabel(t.status)}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <PlanPerformanceTable tierLabel="መምሪያ" />
      </div>

      {/* ── Modals ── */}
      {anchorFor && (
        <Modal onClose={() => setAnchorFor(null)}>
          <div className="modal-head">
            <div className="modal-title">የቡድን ዕቅድ መድብ</div>
            <button className="modal-close" onClick={() => setAnchorFor(null)}>✕</button>
          </div>
          <div className="modal-body">
            <div style={{ marginBottom: 16, padding: 12, background: "var(--slate-bg)", borderRadius: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{anchorFor.unit_name}</div>
              <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>
                ለእያንዳንዱ ቡድን በቡድኑ መሪ የሚመራ አንድ የሩብ ዓመት የሥራ ዕቅድ።
              </div>
            </div>
            <form onSubmit={synthesize}>
              <div className="field">
                <label>የሩብ ዓመት መነሻ ግብ</label>
                <select
                  value={anchorFor.quarterly_id}
                  onChange={(e) => setAnchorFor({ ...anchorFor, quarterly_id: Number(e.target.value) })}
                >
                  {planning.quarterlies.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.title} · {q.quarter || "—"} {q.year}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>የዕቅድ ርዕስ</label>
                <input name="title" placeholder="ለምሳሌ፦ የESIA የማቅረቢያ ሥራ ዕቅድ" required />
              </div>
              <div className="field">
                <label>መግለጫ (አማራጭ)</label>
                <textarea name="description" rows={2} placeholder="ቡድኑ በዚህ ሩብ ዓመት ማሳካት ያለበት" />
              </div>
              <button className="btn btn-primary" type="submit" disabled={saving}>
                {saving ? <><Icons.spinner size={15} /> በመመደብ ላይ…</> : <><Icons.send size={15} /> ዕቅዱን ለቡድን መድብ</>}
              </button>
            </form>
          </div>
        </Modal>
      )}

      {quarterlyForm && planning && (
        <QuarterlyForm planning={planning} onClose={() => setQuarterlyForm(false)} onSaved={() => { setQuarterlyForm(false); loadPlanning(); }} toast={toast} />
      )}

      {editingGoal && (
        <PlanModal goal={editingGoal} onClose={() => setEditingGoal(null)} onSaved={() => { setEditingGoal(null); loadPlanning(); }} toast={toast} />
      )}

      {addingActivityFor && (
        <ActivityForm
          team={addingActivityFor}
          teams={planning ? planning.teams : []}
          onClose={() => setAddingActivityFor(null)}
          onSaved={() => { setAddingActivityFor(null); loadPlanning(); }}
          toast={toast}
        />
      )}

      {editingActivity && (
        <ActivityForm
          team={editingActivity.team}
          teams={planning ? planning.teams : []}
          initial={editingActivity.activity}
          onClose={() => setEditingActivity(null)}
          onSaved={() => { setEditingActivity(null); loadPlanning(); }}
          toast={toast}
        />
      )}

      {authorWeekFor && week && (
        <WeekModal
          employee={authorWeekFor}
          weekStart={week.week_start}
          onClose={() => setAuthorWeekFor(null)}
          onSaved={() => { setAuthorWeekFor(null); loadWeekly(); }}
          toast={toast}
        />
      )}
    </div>
  );
}

function PlanRow({ goal, owned: isOwned, onEdit }) {
  return (
    <div className="goal-row" style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ flex: 1, fontSize: 13 }}>{goal.title}</span>
      <span className={PLAN_STATUS[goal.status] || "chip chip-neutral"} style={{ fontSize: 10 }}>{statusLabel(goal.status)}</span>
      <span className="chip chip-neutral" style={{ fontSize: 10 }}>{goal.tasks_assigned} ተግባራት</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>{goal.progress_pct}%</span>
      {isOwned ? (
        <button className="btn btn-sm" title="ዕቅድ አስተዳድር" onClick={onEdit}>
          <Icons.edit size={13} />
        </button>
      ) : (
        <span className="chip chip-neutral" style={{ fontSize: 9 }}>ዳይሬክተር</span>
      )}
    </div>
  );
}

function QuarterlyForm({ planning, onClose, onSaved, toast }) {
  const [annualId, setAnnualId] = useState(planning.annuals && planning.annuals.length > 0 ? planning.annuals[0].id : "");
  const [teamId, setTeamId] = useState(planning.teams.length > 0 ? planning.teams[0].unit_id : "");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [kpis, setKpis] = useState([]);
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState(null);

  function updateKpi(idx, patch) {
    setKpis((prev) => prev.map((k, i) => (i === idx ? { ...k, ...patch } : k)));
  }

  async function submit(e) {
    e.preventDefault();
    if (!annualId) { setErrMsg("ዓመታዊ መነሻ ግብ ይምረጡ"); return; }
    if (!teamId) { setErrMsg("ዒላማ ቡድን ይምረጡ"); return; }
    setSaving(true);
    try {
      const body = {
        scope: "quarterly",
        parent_id: Number(annualId),
        org_unit_id: Number(teamId),
        title,
        description: desc || undefined,
        status: "draft",
      };
      if (kpis.length > 0) {
        body.kpis = kpis.map((k) => ({
          name: k.name,
          kpi_type: k.kpi_type || "numeric",
          target_value: k.target_value === "" ? null : Number(k.target_value),
          weight: Number(k.weight || 1),
        }));
      }
      await api.post("/strategic-goals", body);
      const team = planning.teams.find((t) => t.unit_id === Number(teamId));
      toast.push(`የሩብ ዓመት ዕቅድ ለ${team ? team.unit_name : "ቡድኑ"} ተዘጋጅቷል`, "success");
      onSaved();
    } catch (err) {
      toast.push(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  const teamName = planning.teams.find((t) => t.unit_id === Number(teamId))?.unit_name || "—";
  return (
    <Modal onClose={onClose}>
      <div className="modal-head">
        <div className="modal-title">የሩብ ዓመት ዕቅድ አዘጋጅ</div>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>
      <div className="modal-body">
        <div style={{ marginBottom: 16, padding: 12, background: "var(--slate-bg)", borderRadius: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>የሩብ ዓመት መነሻ ግብ → {teamName}</div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>
            የሩብ ዓመት ዕቅድ በዓመታዊ ዋና ግብ ሥር ይዘጋጃል፤ ከዚያም ለአንዱ ቡድን የሥራ ዕቅድ ይዘጋጃል።
          </div>
        </div>
        <form onSubmit={submit}>
          <div className="field">
            <label>ዓመታዊ መነሻ ግብ</label>
            <select value={annualId} onChange={(e) => setAnnualId(e.target.value)}>
              {planning.annuals.length === 0 && <option value="">እስካሁን ዓመታዊ ግብ የለም</option>}
              {(planning.annuals || []).map((a) => (
                <option key={a.id} value={a.id}>{a.title} · {a.year}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>ዒላማ ቡድን</label>
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              {planning.teams.map((t) => (
                <option key={t.unit_id} value={t.unit_id}>{t.unit_name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>የዕቅድ ርዕስ</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="ለምሳሌ፦ የሶስተኛ ሩብ ዓመት የESIA ሥራ" />
          </div>
          <div className="field">
            <label>መግለጫ (አማራጭ)</label>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} placeholder="ይህ ሩብ ዓመት ማሳካት ያለበት" />
          </div>
          <div className="field">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <label style={{ margin: 0 }}>KPIዎች</label>
              <button type="button" className="btn btn-sm" onClick={() => setKpis([...kpis, { name: "", kpi_type: "numeric", target_value: "", weight: 1 }])}>
                <Icons.plus size={12} /> KPI ጨምር
              </button>
            </div>
            {kpis.map((k, i) => (
              <div key={i} className="grid grid-3" style={{ marginBottom: 6 }}>
                <input className="input" placeholder="የKPI ስም" value={k.name} onChange={(e) => updateKpi(i, { name: e.target.value })} />
                <select className="input" value={k.kpi_type} onChange={(e) => updateKpi(i, { kpi_type: e.target.value })}>
                  {["percentage", "numeric", "milestone"].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <div style={{ display: "flex", gap: 4 }}>
                  <input className="input" type="number" placeholder="ዒላማ" value={k.target_value} onChange={(e) => updateKpi(i, { target_value: e.target.value })} />
                  <button type="button" className="btn btn-sm" title="አስወግድ" aria-label="አስወግድ" style={{ color: "var(--rose)" }} onClick={() => setKpis(kpis.filter((_, j) => j !== i))}>
                    <Icons.trash size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {errMsg && <div className="error-banner">{errMsg}</div>}
          <button className="btn btn-primary" type="submit" disabled={saving || !title || !annualId || !teamId}>
            {saving ? <><Icons.spinner size={15} /> በማዘጋጀት ላይ…</> : <><Icons.send size={15} /> የሩብ ዓመት ዕቅድ አዘጋጅ</>}
          </button>
        </form>
      </div>
    </Modal>
  );
}

function PlanModal({ goal, onClose, onSaved, toast }) {
  const [title, setTitle] = useState(goal.title || "");
  const [description, setDescription] = useState(goal.description || "");
  const [status, setStatus] = useState(goal.status || "draft");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function save(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await api.put(`/strategic-goals/${goal.id}`, { title, description, status });
      toast.push("ዕቅዱ ተሻሽሏል", "success");
      onSaved();
    } catch (err) {
      toast.push(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!window.confirm("ይህ ዕቅድ ይሰረዝ? ምንም ንዑስ ተግባር ከሌለው ብቻ ሊሰረዝ ይችላል።")) return;
    setDeleting(true);
    try {
      await api.delete(`/strategic-goals/${goal.id}`);
      toast.push("ዕቅዱ ተሰርዟል", "success");
      onSaved();
    } catch (err) {
      toast.push(err.message, "error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="modal-head">
        <div className="modal-title">ዕቅድ አስተዳድር</div>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>
      <div className="modal-body">
        <form onSubmit={save}>
          <div className="field">
            <label>ርዕስ</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="field">
            <label>መግለጫ</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="field">
            <label>ሁኔታ</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {GOAL_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn-primary" type="submit" disabled={saving || !title.trim()}>
              {saving ? <><Icons.spinner size={15} /> በማስቀመጥ ላይ…</> : <><Icons.check size={15} /> አስቀምጥ</>}
            </button>
            <button className="btn" type="button" style={{ color: "var(--rose)" }} disabled={deleting || goal.tasks_assigned > 0} title={goal.tasks_assigned > 0 ? "ንዑስ ተግባር አለው — መሰረዝ አይቻልም" : "ዕቅድ ሰርዝ"} onClick={del}>
              {deleting ? <Icons.spinner size={14} /> : <Icons.trash size={14} />} ሰርዝ
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

function ActivityForm({ team, teams, initial, onClose, onSaved, toast }) {
  const isEdit = !!initial;
  const [planId, setPlanId] = useState("");
  const [title, setTitle] = useState(initial ? initial.title : "");
  const [desc, setDesc] = useState(initial ? (initial.description || "") : "");
  const [due, setDue] = useState(initial ? (initial.due_date || "") : "");
  const [status, setStatus] = useState(initial ? (initial.status || "not_started") : "not_started");
  const [teamId, setTeamId] = useState(initial ? (initial.org_unit_id || team.unit_id) : team.unit_id);
  const [progress, setProgress] = useState(initial ? initial.progress_pct : 0);
  const [goals, setGoals] = useState([]);
  const [goal, setGoal] = useState(initial ? (initial.strategic_goal_id || "") : "");
  const [kpis, setKpis] = useState(initial ? initial.kpis.map((k) => ({ ...k })) : []);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errMsg, setErrMsg] = useState(null);

  const progressManaged = initial && (initial.member_task_count > 0 || initial.kpis.length > 0);

  const planOptions = (team.plans || [])
    .map((p) => ({ id: p.id, label: `${p.title} (የሥራ ዕቅድ)` }))
    .concat((team.quarterly_plans || []).map((q) => ({ id: q.id, label: `${q.title} (የሩብ ዓመት መነሻ)` })));

  useEffect(() => {
    if (isEdit) return;
    if (!planId && planOptions.length > 0) setPlanId(planOptions[0].id);
  }, [isEdit, planId, planOptions]);

  useEffect(() => {
    if (!isEdit || !initial.program_id) { setGoals([]); return; }
    api.get(`/programs/${initial.program_id}/assignable-goals?org_unit_id=${teamId}`)
      .then((rows) => { setGoals(rows || []); setErrMsg(null); })
      .catch(() => setGoals([]));
  }, [isEdit, initial, teamId]);

  function updateKpi(idx, patch) {
    setKpis((prev) => prev.map((k, i) => (i === idx ? { ...k, ...patch } : k)));
  }

  async function submit(e) {
    e.preventDefault();
    if (!title.trim()) { setErrMsg("ርዕስ ያስፈልጋል"); return; }
    if (isEdit && initial.member_task_count > 0 && teamId !== initial.org_unit_id) {
      setErrMsg("ይህ ተግባር የአባላት ተግባራት አሉት — ከመከፋፈልዎ በፊት ያንቀሳቅሱት ወይም መጀመሪያ ይሰርዙት።");
      return;
    }
    if (!isEdit && !planId) { setErrMsg("ይህ ተግባር የሚገናኝበትን ዕቅድ ይምረጡ"); return; }
    setSaving(true);
    try {
      if (isEdit) {
        const body = {
          title,
          description: desc || null,
          status,
          due_date: due || null,
          strategic_goal_id: goal ? Number(goal) : null,
        };
        if (teamId !== initial.org_unit_id) body.org_unit_id = teamId;
        if (!progressManaged) body.progress_pct = Math.max(0, Math.min(100, Number(progress) || 0));
        await api.put(`/programs/activities/${initial.id}`, body);

        const initialIds = new Set((initial.kpis || []).map((k) => k.id));
        for (const k of kpis) {
          const payload = {
            name: k.name,
            kpi_type: k.kpi_type || "numeric",
            target_value: k.target_value === "" || k.target_value == null ? null : Number(k.target_value),
            actual_value: k.actual_value === "" || k.actual_value == null ? null : Number(k.actual_value),
            weight: Number(k.weight || 1),
          };
          if (k.id) await api.put(`/programs/kpis/${k.id}`, payload);
          else await api.post(`/programs/activities/${initial.id}/kpis`, payload);
        }
        for (const k of initial.kpis || []) {
          if (!kpis.some((cur) => String(cur.id) === String(k.id))) {
            await api.delete(`/programs/kpis/${k.id}`);
          }
        }
      } else {
        const body = {
          title,
          description: desc || null,
          org_unit_id: teamId,
          due_date: due || null,
          status,
        };
        if (kpis.length > 0) {
          body.kpis = kpis.map((k) => ({
            name: k.name,
            kpi_type: k.kpi_type || "numeric",
            target_value: k.target_value === "" ? null : Number(k.target_value),
            actual_value: k.actual_value === "" ? null : Number(k.actual_value),
            weight: Number(k.weight || 1),
          }));
        }
        await api.post(`/strategic-goals/${planId}/activities`, body);
      }
      toast.push(isEdit ? "ተግባሩ ተሻሽሏል" : `ተግባሩ በ${team.unit_name} ዕቅድ ላይ ተጨምሯል`, "success");
      onSaved();
    } catch (err) {
      toast.push(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!window.confirm("ይህ ተግባርና የአባላቱ ንዑስ ተግባራት ይሰረዙ?")) return;
    setDeleting(true);
    try {
      await api.delete(`/programs/activities/${initial.id}`);
      toast.push("ተግባሩ ተሰርዟል", "success");
      onSaved();
    } catch (err) {
      toast.push(err.message, "error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="modal-head">
        <div className="modal-title">{isEdit ? "ተግባር አርትዕ" : "የቡድን ተግባር ጨምር"}</div>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>
      <div className="modal-body">
        <div style={{ marginBottom: 16, padding: 12, background: "var(--slate-bg)", borderRadius: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            {isEdit ? (initial.strategic_goal_title || initial.program_name || "የቡድን ተግባር") : team.unit_name}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>
            {isEdit
              ? "በመምሪያው የተዘጋጀውን ተግባር ያሻሽሉ፤ KPIዎች አፈጻጸሙን በራስ-ሰር ያሰላሉ።"
              : "ከቡድኑ ዕቅዶች አንዱን ያገናኙ፤ ከዚያ የቡድን መሪው ወደ አባላት ተግባራት ሊከፋፍለው ይችላል።"}
          </div>
        </div>
        <form onSubmit={submit}>
          {!isEdit && (
            <div className="field">
              <label>ዕቅድ</label>
              <select value={planId} onChange={(e) => setPlanId(e.target.value)} disabled={planOptions.length === 0}>
                {planOptions.length === 0 ? (
                  <option value="">በመጀመሪያ ለዚህ ቡድን ዕቅድ ያዘጋጁ</option>
                ) : (
                  planOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)
                )}
              </select>
              {planOptions.length === 0 && (
                <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
                  ከላይ ያለውን “የቡድን ዕቅድ አዘጋጅ” በመጠቀም መጀመሪያ ለዚህ ቡድን የሥራ ዕቅድ ይስጡ።
                </div>
              )}
            </div>
          )}
          {isEdit && (
            <div className="field">
              <label>ለቡድን እንደገና መድብ</label>
              <select value={teamId} onChange={(e) => setTeamId(e.target.value)} disabled={initial.member_task_count > 0}>
                {(teams && teams.length > 0 ? teams : [team]).map((t) => (
                  <option key={t.unit_id} value={t.unit_id}>{t.unit_name}</option>
                ))}
              </select>
              {initial.member_task_count > 0 && (
                <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
                  ተግባሩ የአባላት ተግባራት ስላሉት ተቆልፏል።
                </div>
              )}
            </div>
          )}
          <div className="field">
            <label>የተግባር ርዕስ</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="ለምሳሌ፦ የESIA የመስክ ምርመራ" />
          </div>
          <div className="field">
            <label>መግለጫ (አማራጭ)</label>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} placeholder="ዝርዝሮች…" />
          </div>
          <div className="field">
            <label>የመጨረሻ ቀን (አማራጭ)</label>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <div className="field">
            <label>ሁኔታ</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {ACTIVITY_STATUSES.map((s) => <option key={s} value={s}>{ACTIVITY_STATUS_LABELS[s]}</option>)}
            </select>
          </div>
          {isEdit && (
            <div className="field">
              <label>የሚያገለግለው ግብ / ዕቅድ (አማራጭ)</label>
              <select value={goal} onChange={(e) => setGoal(e.target.value || "")}>
                <option value="">የለም</option>
                {goals.map((g) => <option key={g.id} value={g.id}>{g.title}{g.scope ? ` (${g.scope})` : ""}</option>)}
              </select>
            </div>
          )}
          {isEdit && (
            <div className="field">
              <label>አፈጻጸም</label>
              {progressManaged ? (
                <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                  በራስ-ሰር የሚሰላው በ{initial.kpis.length > 0 ? "ውጤት KPIዎች" : "የአባላት ተግባራት"} ነው — እነዚህን ያሻሽሉ።
                </div>
              ) : (
                <input type="number" min={0} max={100} value={progress} onChange={(e) => setProgress(e.target.value)} />
              )}
            </div>
          )}
          <div className="field">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <label style={{ margin: 0 }}>የውጤት KPIዎች</label>
              <button type="button" className="btn btn-sm" onClick={() => setKpis([...kpis, { name: "", kpi_type: "numeric", target_value: "", actual_value: "", weight: 1 }])}>
                <Icons.plus size={12} /> KPI ጨምር
              </button>
            </div>
            {kpis.map((k, i) => (
              <div key={k.id || `new-${i}`} className="grid grid-3" style={{ marginBottom: 6 }}>
                <input className="input" placeholder="የKPI ስም" value={k.name} onChange={(e) => updateKpi(i, { name: e.target.value })} />
                <select className="input" value={k.kpi_type} onChange={(e) => updateKpi(i, { kpi_type: e.target.value })}>
                  {["percentage", "numeric", "milestone"].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <div style={{ display: "flex", gap: 4 }}>
                  <input className="input" type="number" placeholder="ዒላማ" value={k.target_value ?? ""} onChange={(e) => updateKpi(i, { target_value: e.target.value })} />
                  <input className="input" type="number" placeholder="ትክክለኛ" value={k.actual_value ?? ""} onChange={(e) => updateKpi(i, { actual_value: e.target.value })} />
                  <button type="button" className="btn btn-sm" title="አስወግድ" aria-label="አስወግድ" style={{ color: "var(--rose)" }} onClick={() => setKpis(kpis.filter((_, j) => j !== i))}>
                    <Icons.trash size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {errMsg && <div className="error-banner">{errMsg}</div>}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn-primary" type="submit" disabled={saving || !title.trim() || (!isEdit && !planId)}>
              {saving ? <><Icons.spinner size={15} /> በማስቀመጥ ላይ…</> : <Icons.send size={15} />}
              {" "}{isEdit ? "ለውጦችን አስቀምጥ" : `ተግባር ለ${team.unit_name} ጨምር`}
            </button>
            {isEdit && (
              <button className="btn" type="button" style={{ color: "var(--rose)" }} disabled={deleting} onClick={del}>
                {deleting ? <Icons.spinner size={14} /> : <Icons.trash size={14} />} ሰርዝ
              </button>
            )}
          </div>
        </form>
      </div>
    </Modal>
  );
}

function WeekModal({ employee, weekStart, onClose, onSaved, toast }) {
  const [rows, setRows] = useState(
    (employee.tasks || []).map((t) => ({
      title: t.title,
      status: t.status || "todo",
      day_of_week: t.day_of_week || "",
      strategic_goal_id: t.strategic_goal_id || "",
    }))
  );
  const [goalOptions, setGoalOptions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState(null);

  useEffect(() => {
    api.get("/strategic-goals")
      .then((rows) => {
        const mine = (rows || []).filter(
          (g) => g.scope === "individual" && g.assigned_to_id === employee.employee_id && g.status !== "cancelled"
        );
        setGoalOptions(mine);
        setErrMsg(null);
      })
      .catch((err) => setErrMsg(err.message));
  }, [employee.employee_id]);

  function updateRow(i, patch) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function submit(e) {
    e.preventDefault();
    const tasks = rows
      .filter((r) => r.title.trim())
      .map((r) => ({
        title: r.title.trim(),
        status: r.status || "todo",
        day_of_week: r.day_of_week ? Number(r.day_of_week) : null,
        strategic_goal_id: r.strategic_goal_id ? Number(r.strategic_goal_id) : null,
      }));
    if (tasks.length === 0) { setErrMsg("ቢያንስ አንድ ተግባር ይጨምሩ"); return; }
    setSaving(true);
    try {
      await api.post(`/weekly-plans/${employee.employee_id}/current`, { tasks });
      toast.push(`የ${weekStart} ሳምንት ዕቅድ ለ${employee.full_name} ተዘጋጅቷል`, "success");
      onSaved();
    } catch (err) {
      toast.push(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="modal-head">
        <div className="modal-title">የ{employee.full_name} ሳምንታዊ ዕቅድ አዘጋጅ</div>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>
      <div className="modal-body">
        <div style={{ marginBottom: 16, padding: 12, background: "var(--slate-bg)", borderRadius: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{employee.position || "የቡድን አባል"} · የ{weekStart} ሳምንት</div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>
            የቡድን/የሩብ ዓመት ዕቅዶችን ወደ የአባሉ ሳምንታዊ ዕቅድ ያዋህዱ። ተግባራት የአባሉን የግል ግቦች ሊይዙ ይችላሉ።
          </div>
        </div>
        <form onSubmit={submit}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
            {rows.map((r, i) => (
              <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 8 }}>
                <input className="input" placeholder="የተግባር ርዕስ" value={r.title} onChange={(e) => updateRow(i, { title: e.target.value })} />
                <div className="grid grid-3" style={{ marginTop: 6 }}>
                  <select className="input" value={r.day_of_week} onChange={(e) => updateRow(i, { day_of_week: e.target.value })}>
                    <option value="">ቀን የለም</option>
                    {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}
                  </select>
                  <select className="input" value={r.status} onChange={(e) => updateRow(i, { status: e.target.value })}>
                    {["todo", "in_progress", "done"].map((s) => <option key={s} value={s}>{s === "todo" ? "ያልተጀመረ" : s === "in_progress" ? "በሂደት ላይ" : "ተጠናቋል"}</option>)}
                  </select>
                  <select className="input" value={r.strategic_goal_id} onChange={(e) => updateRow(i, { strategic_goal_id: e.target.value })}>
                    <option value="">ግብ የለም</option>
                    {goalOptions.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
                  </select>
                </div>
                <div style={{ marginTop: 6 }}>
                  <button type="button" className="btn btn-sm" style={{ color: "var(--rose)" }} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                    <Icons.trash size={12} /> አስወግድ
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setRows([...rows, { title: "", status: "todo", day_of_week: "", strategic_goal_id: "" }])}
          >
            <Icons.plus size={13} /> ተግባር ጨምር
          </button>
          {errMsg && <div style={{ marginTop: 8 }}><div className="error-banner">{errMsg}</div></div>}
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? <><Icons.spinner size={15} /> በማስቀመጥ ላይ…</> : <><Icons.send size={15} /> የ{employee.full_name} ሳምንት አስቀምጥ</>}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

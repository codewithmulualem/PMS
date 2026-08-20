import { useEffect, useState } from "react";
import { api } from "../api";
import { useCycle } from "../context/CycleContext";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import Topbar from "../components/Topbar";
import ScoreRing from "../components/ScoreRing";
import RatingBadge from "../components/RatingBadge";
import MeterRow from "../components/MeterRow";
import EpistemicTag from "../components/EpistemicTag";
import RadarChart from "../components/RadarChart";
import TrendChart from "../components/TrendChart";
import Skeleton from "../components/Skeleton";
import ManagerEvalModal from "../components/ManagerEvalModal";
import { StatTrend } from "../components/StatCard";
import { Icons } from "../components/icons";

const COMPONENT_COLORS = {
  kpi_score: "var(--indigo)",
  goal_score: "var(--teal)",
  competency_score: "var(--amber)",
  behavior_score: "var(--slate)",
  program_score: "var(--green)",
};
const COMPONENT_LABELS = {
  kpi_score: "KPIs",
  goal_score: "Goals",
  competency_score: "Competencies",
  behavior_score: "Behavior",
  program_score: "Programs",
};

const STATUS_CHIP = {
  completed: "chip chip-success",
  in_progress: "chip chip-indigo",
  at_risk: "chip chip-danger",
  not_started: "chip chip-neutral",
  cancelled: "chip chip-neutral",
};

function initials(name = "") {
  return name.split(" ").filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join("");
}

export default function EmployeeDashboard({ employeeId, backLabel, onBack }) {
  const { cycleId, current } = useCycle();
  const toast = useToast();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [evalTarget, setEvalTarget] = useState(null);
  const isOwner = user?.employee_id === employeeId;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const d = await api.get(`/employees/${employeeId}/dashboard?cycle_id=${cycleId || ""}`);
      setData(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, cycleId]);

  if (loading && !data) return <Skeleton lines={8} height={20} />;
  if (error) return <div className="error-banner">{error}</div>;
  if (!data) return null;

  const { employee, score, previous_score, benchmarks, goals, competencies, history, evaluations, evaluation_results, insights } = data;
  const kpis = score?.explanation?.kpis || [];
  const scoredGoals = score?.explanation?.goals || [];
  const selfEval = evaluations.find((e) => e.evaluator_type === "self");
  const managerEval = evaluations.find((e) => e.evaluator_type === "manager");
  const canAssess = !isOwner && (
    ["admin", "executive"].includes(user?.role) ||
    (user?.role === "manager" && user?.employee_id === employee.manager_id)
  );
  const delta = previous_score != null && score?.overall_score != null ? score.overall_score - previous_score : null;

  return (
    <div>
      <Topbar
        subtitle={`${employee.position || "—"} · ${employee.department_name || "—"} · ${employee.job_grade || ""}`}
        onBack={onBack}
        backLabel={backLabel}
      >
        <span className="chip chip-neutral">{employee.employment_status}</span>
        {canAssess && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setEvalTarget({
              employee: { id: employee.id, full_name: employee.full_name, position: employee.position },
              manager_evaluation: managerEval || null,
            })}
          >
            <Icons.edit size={13} /> Assess
          </button>
        )}
      </Topbar>

      <div className="grid grid-2">
        {/* Overall score hero */}
        <div className="card">
          <div className="card-title">Overall Performance <EpistemicTag kind="calc" /></div>
          {score && score.overall_score != null ? (
            <>
              <div className="score-hero">
                <ScoreRing score={score.overall_score} color={score.rating?.color} />
                <div className="hero-meta">
                  <RatingBadge rating={score.rating} />
                  <div className="hero-delta">
                    <span>vs previous cycle</span>
                    <StatTrend delta={delta} />
                  </div>
                </div>
              </div>
              <div className="benchmark-line">
                <span className="bm"><Icons.chart size={13} /> Team avg <b>{benchmarks?.team_average?.toFixed(1) ?? "—"}</b></span>
                <span className="bm"><Icons.org size={13} /> Org avg <b>{benchmarks?.organization_average?.toFixed(1) ?? "—"}</b></span>
                <span className="bm"><Icons.clock size={13} /> Cycle <b>{current?.name || data.cycle_id}</b></span>
              </div>
              <div style={{ marginTop: 16 }}>
                {Object.keys(COMPONENT_LABELS).map((key) => (
                  <MeterRow
                    key={key}
                    label={COMPONENT_LABELS[key]}
                    value={score[key]}
                    color={COMPONENT_COLORS[key]}
                  />
                ))}
              </div>
              {score?.weights && (
                <div className="text-faint" style={{ fontSize: 11.5, marginTop: 8 }}>
                  Weighting: {Object.entries({ kpi: score.weights.kpi_weight, goal: score.weights.goal_weight, comp: score.weights.competency_weight, behavior: score.weights.behavior_weight, proj: score.weights.program_weight })
                    .map(([k, v]) => `${k} ${Math.round(v || 0)}%`).join(" · ")}
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">◎</div>
              Not enough scored data for this cycle yet.
            </div>
          )}
        </div>

        {/* AI Intelligence */}
        <div className="card">
          <div className="card-title">AI Performance Intelligence <EpistemicTag kind="insight" /></div>
          {insights && insights.length > 0 ? (
            insights.slice(0, 4).map((ins) => (
              <div key={ins.id} className={`insight-card ${ins.insight_type}`}>
                <div className="insight-head">
                  <EpistemicTag kind={ins.insight_type === "prediction" ? "prediction" : ins.insight_type === "anomaly" || ins.insight_type === "risk_flag" ? "risk" : "insight"} />
                  {ins.confidence != null && <span className="text-faint mono" style={{ fontSize: 11 }}>confidence {Math.round(ins.confidence * 100)}%</span>}
                </div>
                <div>{ins.content}</div>
                {ins.supporting_data && (
                  <div className="insight-src" title={ins.supporting_data}>
                    supports: {Object.keys(typeof ins.supporting_data === "string" ? {} : ins.supporting_data).join(", ") || "attached data"}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="empty-state">
              <div className="empty-icon">✦</div>
              No AI insights generated yet for this cycle.
              <div style={{ marginTop: 12 }}>
                <button className="btn btn-primary btn-sm" onClick={generateInsights} disabled={generating}>
                  <Icons.spark size={15} /> {generating ? "Analyzing…" : "Generate insights"}
                </button>
              </div>
            </div>
          )}
          {insights?.length > 0 && (
            <div className="flex gap-8" style={{ marginTop: 10 }}>
              <button className="btn btn-secondary btn-sm" onClick={generateInsights} disabled={generating}>
                <Icons.spark size={15} /> {generating ? "Analyzing…" : "Regenerate"}
              </button>
            </div>
          )}
          <div className="text-faint" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.5 }}>
            Advisory only — insights are derived from data on this page. Human review is required before any employment decision.
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        {/* KPIs */}
        <div className="card">
          <div className="card-title">KPIs <EpistemicTag kind="fact" /></div>
          {kpis.length === 0 ? (
            <div className="empty-state">No KPIs assigned for this cycle.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>KPI</th><th className="num">Achievement</th><th className="num">Weight</th></tr>
                </thead>
                <tbody>
                  {kpis.map((k) => (
                    <tr key={k.id}>
                      <td>
                        <div className="cell-strong">{k.name}</div>
                        <div className="cell-sub">{k.actual_value ?? "—"} / {k.target_value} {k.measurement_unit}{k.direction === "lower_is_better" ? " · lower is better" : ""}</div>
                      </td>
                      <td className="num">
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <div className="meter-track" style={{ width: 60, height: 6 }}>
                            <div className="meter-fill" style={{ width: `${Math.min(100, k.achievement_pct || 0)}%`, background: (k.achievement_pct || 0) < 70 ? "var(--crimson)" : (k.achievement_pct || 0) < 90 ? "var(--amber)" : "var(--green)" }} />
                          </div>
                          {k.achievement_pct != null ? `${Math.round(k.achievement_pct)}%` : "—"}
                        </div>
                      </td>
                      <td className="num">{Math.round((k.weight || 0) * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Goals */}
        <div className="card">
          <div className="card-title">Goals <EpistemicTag kind="fact" /></div>
          {goals.length === 0 ? (
            <div className="empty-state">No goals assigned for this cycle.</div>
          ) : (
            goals.map((goal) => {
              const pct = goal.actual_value != null && goal.target_value ? Math.min(120, (goal.actual_value / goal.target_value) * 100) : null;
              return (
                <div className="goal-row" key={goal.id}>
                  <div className="goal-title">
                    {goal.title}
                    <span className={STATUS_CHIP[goal.status] || "chip chip-neutral"}>{goal.status.replace("_", " ")}</span>
                  </div>
                  {goal.description && <div className="text-dim" style={{ fontSize: 12.5 }}>{goal.description}</div>}
                  <div className="goal-meta">
                    <span className="mono">{goal.actual_value ?? 0} / {goal.target_value} {goal.measurement_unit}</span>
                    <span>Weight {Math.round((goal.weight || 0) * 100)}%</span>
                    <span>Due {goal.end_date || "—"}</span>
                    <span className="chip chip-indigo" style={{ textTransform: "none" }}>goal</span>
                  </div>
                  <div>
                    <div className="meter-track">
                      <div className="meter-fill" style={{ width: `${Math.min(100, pct || 0)}%`, background: pct >= 100 ? "var(--green)" : pct >= 70 ? "var(--indigo)" : "var(--amber)" }} />
                    </div>
                    <div className="progress-label-row">
                      <span>achievement</span>
                      <b>{pct != null ? `${pct.toFixed(0)}%` : "—"}</b>
                    </div>
                  </div>
                  <GoalProgressEditor goal={goal} onSave={updateGoalProgress} />
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="grid grid-2">
        {/* Competencies */}
        <div className="card">
          <div className="card-title">Competency Profile <EpistemicTag kind="fact" /></div>
          {competencies.length === 0 ? (
            <div className="empty-state">No competency assessments yet.</div>
          ) : (
            <>
              <RadarChart items={competencies.map((c) => ({ label: c.competency_name, value: c.current_level, target: c.target_level || 5 }))} />
              <div style={{ marginTop: 6 }}>
                {competencies.map((c) => (
                  <MeterRow
                    key={c.id}
                    label={c.competency_name}
                    value={(c.current_level / 5) * 100}
                    color="var(--amber)"
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Score history + trend */}
        <div className="card">
          <div className="card-title">Score History <EpistemicTag kind="calc" /></div>
          {history.length === 0 ? (
            <div className="empty-state">No prior cycles recorded yet.</div>
          ) : (
            <>
              <TrendChart
                points={history.map((h) => ({ label: h.cycle_name?.split(" ")[0] || "", value: h.overall_score }))}
                benchmark={benchmarks?.organization_average}
              />
              <div className="divider" />
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Cycle</th><th className="num">Score</th><th>Rating</th></tr></thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id}>
                        <td className="cell-strong">{h.cycle_name}</td>
                        <td className="num">{h.overall_score != null ? h.overall_score.toFixed(1) : "—"}</td>
                        <td><span className="chip chip-neutral">{h.rating_label || "—"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Evaluations / self assessment */}
      <div className="card">
        <div className="card-title">Evaluations <EpistemicTag kind="fact" /></div>
        <div className="grid grid-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {isOwner && (
            <SelfAssessment
              existing={selfEval}
              employeeId={employeeId}
              cycleId={cycleId}
              onSaved={load}
              toast={toast}
            />
          )}
          <div>
            <div className="flex-between" style={{ marginBottom: 10 }}>
              <div className="cell-strong">360 evaluation results</div>
              <EpistemicTag kind="fact" />
            </div>
            {(!evaluation_results || evaluation_results.length === 0) ? (
              <div className="text-faint" style={{ fontSize: 13 }}>No 360 evaluation forms for this cycle.</div>
            ) : (
              <>
                {evaluation_results.map((r) => (
                  <div key={r.id} className="flex-between" style={{ padding: "9px 0", borderBottom: "1px solid #f0f2f7" }}>
                    <div>
                      <div className="cell-strong" style={{ textTransform: "capitalize" }}>
                        {r.evaluator_type} {r.evaluator_type === "manager" && <span className="chip chip-indigo">manager</span>}
                      </div>
                      <div className="cell-sub">{r.form_name} · by {r.evaluator_name || "—"} · {r.status}</div>
                    </div>
                    <div className="mono" style={{ fontSize: 13 }}>
                      {r.score != null ? r.score.toFixed(1) : "—"}
                      {r.overall_score != null && <span className="text-faint" title="Combined 360 score"> · 360 {r.overall_score.toFixed(1)}</span>}
                    </div>
                  </div>
                ))}
              </>
            )}

            <div className="flex-between" style={{ margin: "12px 0 10px" }}>
              <div className="cell-strong">Received evaluations</div>
              <EpistemicTag kind="fact" />
            </div>
            {evaluations.length === 0 ? (
              <div className="text-faint" style={{ fontSize: 13 }}>No evaluations on record for this cycle.</div>
            ) : (
              evaluations.map((e) => (
                <div key={e.id} className="flex-between" style={{ padding: "9px 0", borderBottom: "1px solid #f0f2f7" }}>
                  <div>
                    <div className="cell-strong" style={{ textTransform: "capitalize" }}>
                      {e.evaluator_type} {e.evaluator_type === "manager" && <span className="chip chip-indigo">manager</span>}
                    </div>
                    <div className="cell-sub">by {e.evaluator_username || "system"} · {e.status}</div>
                  </div>
                  <div className="mono" style={{ fontSize: 13 }}>
                    {e.behavior_score != null ? `B ${e.behavior_score}` : "B —"} ·{" "}
                    {e.program_score != null ? `P ${e.program_score}` : "P —"}
                  </div>
                </div>
              ))
            )}
            {managerEval?.comments && (
              <div className="insight-card" style={{ marginTop: 10 }}>
                <div className="insight-head"><EpistemicTag kind="fact" /><span className="cell-sub">manager comments</span></div>
                {managerEval.comments}
              </div>
            )}
          </div>
        </div>
      </div>

      {evalTarget && (
        <ManagerEvalModal
          member={evalTarget}
          cycleId={cycleId}
          onClose={() => setEvalTarget(null)}
          onSaved={() => { setEvalTarget(null); load(); }}
          toast={toast}
        />
      )}
    </div>
  );

  async function updateGoalProgress(goalId, actualValue) {
    await api.put(`/goals/${goalId}`, { actual_value: Number(actualValue) });
    toast.push("Goal progress updated", "success");
    load();
  }

  async function generateInsights() {
    if (!cycleId) {
      toast.push("Select an active performance cycle first", "error");
      return;
    }
    setGenerating(true);
    try {
      await api.post(`/ai/employees/${employeeId}/insights`, { cycle_id: cycleId });
      toast.push("Fresh AI insights generated", "success");
      load();
    } catch (err) {
      toast.push(err.message, "error");
    } finally {
      setGenerating(false);
    }
  }
}

function GoalProgressEditor({ goal, onSave }) {
  const [value, setValue] = useState(goal.actual_value ?? 0);
  const [saving, setSaving] = useState(false);
  const dirty = Number(value) !== Number(goal.actual_value ?? 0);

  async function save() {
    setSaving(true);
    try {
      await onSave(goal.id, value);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex gap-8" style={{ alignItems: "center", marginTop: 2 }}>
      <input
        type="number"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{ width: 96, padding: "6px 9px", border: "1px solid var(--line-strong)", borderRadius: 8, fontSize: 13 }}
        aria-label="Current actual value"
      />
      <span className="text-faint" style={{ fontSize: 12 }}>current actual</span>
      {dirty && (
        <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Update"}
        </button>
      )}
    </div>
  );
}

function SelfAssessment({ existing, employeeId, cycleId, onSaved, toast }) {
  const [behavior, setBehavior] = useState(existing?.behavior_score ?? "");
  const [comments, setComments] = useState(existing?.comments ?? "");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/evaluations", {
        employee_id: employeeId,
        cycle_id: cycleId,
        evaluator_type: "self",
        behavior_score: behavior === "" ? null : Number(behavior),
        comments: comments || null,
      });
      toast.push(existing ? "Self-assessment updated" : "Self-assessment submitted", "success");
      onSaved();
    } catch (err) {
      toast.push(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="flex-between" style={{ marginBottom: 10 }}>
        <div className="cell-strong">Self-assessment</div>
        {existing ? <span className="chip chip-success">submitted</span> : <span className="chip chip-neutral">pending</span>}
      </div>
      <div className="field">
        <label>Behavior score (0–100)</label>
        <input type="number" min="0" max="100" value={behavior} onChange={(e) => setBehavior(e.target.value)} placeholder="e.g. 78" />
      </div>
      <div className="field">
        <label>Reflection & evidence</label>
        <textarea value={comments} onChange={(e) => setComments(e.target.value)} placeholder="What went well, what to improve, supporting evidence…" />
      </div>
      <button className="btn btn-primary" type="submit" disabled={saving || !cycleId}>
        <Icons.send size={15} /> {saving ? "Saving…" : existing ? "Update self-assessment" : "Submit self-assessment"}
      </button>
      {!cycleId && <div className="hint text-faint" style={{ marginTop: 6 }}>Select a performance cycle to submit.</div>}
    </form>
  );
}

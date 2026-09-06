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

const TASK_STATUS = {
  todo: "chip chip-neutral",
  in_progress: "chip chip-indigo",
  done: "chip chip-success",
};

const KPI_INPUT = {
  padding: "7px 9px",
  borderRadius: 8,
  border: "1px solid var(--line-strong)",
  fontSize: 12,
  boxSizing: "border-box",
};

const EMPTY_KPI = () => ({ name: "", kpi_type: "numeric", target_value: "", unit: "" });

function buildAssignments(items) {
  const assignments = [];
  for (const i of items) {
    const title = i.title ? i.title.trim() : "";
    if (!title) continue;
    const kpis = (i.kpis || [])
      .filter((k) => k.name && k.name.trim())
      .map((k) => ({
        name: k.name.trim(),
        kpi_type: k.kpi_type,
        target_value:
          k.target_value === "" || k.target_value == null ? null : Number(k.target_value),
        unit: (k.unit || "").trim() || undefined,
      }));
    if (kpis.length === 0) {
      return { error: `${i.member_name}፦ እያንዳንዱ የአባል ተግባር ቢያንስ አንድ KPI ያስፈልገዋል` };
    }
    if (kpis.some((k) => k.target_value == null && k.kpi_type !== "milestone")) {
      return { error: `${i.member_name}፦ የቁጥር/መቶኛ KPI ዒላማ ያስፈልገዋል` };
    }
    assignments.push({ title, assigned_to_id: i.member_id, kpis });
  }
  if (assignments.length === 0) {
    return { error: "ቢያንስ አንድ የአባል ተግባር ይሰይሙ" };
  }
  return { assignments, error: null };
}

function KpiEditor({ kpis, onChange }) {
  const update = (idx, patch) =>
    onChange(kpis.map((k, i) => (i === idx ? { ...k, ...patch } : k)));

  return (
    <div style={{ marginTop: 4 }}>
      <div className="flex-between" style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>
          KPIዎች <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>— እያንዳንዱ ተግባር ቢያንስ አንድ ያስፈልገዋል</span>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...kpis, EMPTY_KPI()])}>
          <Icons.plus size={12} /> KPI ጨምር
        </button>
      </div>
      {kpis.map((k, idx) => (
        <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
          <input
            value={k.name}
            onChange={(e) => update(idx, { name: e.target.value })}
            placeholder="የKPI ስም"
            style={{ ...KPI_INPUT, flex: 1 }}
          />
          <select value={k.kpi_type} onChange={(e) => update(idx, { kpi_type: e.target.value })} style={KPI_INPUT}>
            <option value="numeric">ቁጥር</option>
            <option value="percentage">መቶኛ</option>
            <option value="milestone">የደረጃ ምልክት</option>
          </select>
          <input
            type="number"
            value={k.target_value}
            onChange={(e) => update(idx, { target_value: e.target.value })}
            placeholder="ዒላማ"
            style={{ ...KPI_INPUT, width: 90 }}
          />
          <input
            value={k.unit}
            onChange={(e) => update(idx, { unit: e.target.value })}
            placeholder="መለኪያ"
            style={{ ...KPI_INPUT, width: 64 }}
          />
          {kpis.length > 1 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(kpis.filter((_, j) => j !== idx))}>
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export default function TeamPlansPage() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [target, setTarget] = useState(null);
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [drillActivity, setDrillActivity] = useState(null);
  const [drillTitle, setDrillTitle] = useState("");
  const [drillAssignee, setDrillAssignee] = useState("");
  const [drillSaving, setDrillSaving] = useState(false);

  async function load() {
    try {
      setError(null);
      const res = await api.get("/strategic-goals/team");
      setData(res);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openSync(plan) {
    setItems(
      data.members.map((m) => ({
        member_id: m.id,
        member_name: m.full_name,
        title: `${plan.title} – ${m.full_name}`,
        kpis: [EMPTY_KPI()],
      }))
    );
    setTarget(plan);
  }

  async function synthesize(e) {
    e.preventDefault();
    const { assignments, error: kpiError } = buildAssignments(items);
    if (kpiError) {
      toast.push(kpiError, "error");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/strategic-goals/${target.id}/assign`, { assignments });
      toast.push(`${assignments.length} የአባል ተግባራት ተፈጥረዋል`, "success");
      setTarget(null);
      load();
    } catch (err) {
      toast.push(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function drillDown(e) {
    e.preventDefault();
    if (!drillAssignee || !drillTitle.trim()) return;
    setDrillSaving(true);
    try {
      if (drillActivity.strategic_goal_id) {
        await api.post(`/strategic-goals/${drillActivity.strategic_goal_id}/activities`, {
          title: drillTitle.trim(),
          parent_id: drillActivity.id,
          assignee_id: Number(drillAssignee),
        });
      } else {
        await api.post(`/programs/${drillActivity.program_id}/activities`, {
          title: drillTitle.trim(),
          parent_id: drillActivity.id,
          assignee_id: Number(drillAssignee),
        });
      }
      toast.push(`ተግባሩ ለ${data.members.find((m) => m.id === Number(drillAssignee))?.full_name} ተመድቧል`, "success");
      setDrillActivity(null);
      setDrillTitle("");
      setDrillAssignee("");
      load();
    } catch (err) {
      toast.push(err.message, "error");
    } finally {
      setDrillSaving(false);
    }
  }

  return (
    <div className="page-enter">
      {/* Planning header: the dept-assigned plan -> member tasks */}
      <div className="card">
        <div className="card-title">
          የቡድን የሥራ ዕቅድ
          <span className="chip chip-neutral">የቡድን መሪ</span>
        </div>
        <div className="card-sub">
          የሩብ ዓመት ዕቅድዎ በመምሪያ ኃላፊ ተመድቧል፤ ለእያንዳንዱ አባል በKPI የሚለካ ተግባር ይፍጠሩ።
        </div>

        {data === null && !error ? (
          <Skeleton lines={6} height={18} />
        ) : error ? (
          <div className="error-banner">{error}</div>
        ) : (
          <div style={{ marginTop: 4 }}>
            {data.plans.length === 0 ? (
              <div style={{ padding: "10px 0", fontSize: 13, color: "var(--text-dim)" }}>
                እስካሁን ለቡድንዎ ዕቅድ አልተመደበም።
              </div>
            ) : (
              data.plans.map((plan, idx) => (
                <div key={plan.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, marginBottom: 10 }}>
                  <div className="flex-between">
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{plan.title}</div>
                    <span className={PLAN_STATUS[plan.status] || "chip chip-neutral"} style={{ fontSize: 10 }}>
                      {statusLabel(plan.status)}
                    </span>
                  </div>

                  {(data.anchors[idx] || []).length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                      {data.anchors[idx].map((a) => (
                        <span key={a.id} className="chip chip-neutral" style={{ fontSize: 10 }}>
                          {a.title}
                        </span>
                      ))}
                    </div>
                  )}

                  <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={() => openSync(plan)}>
                    <Icons.plus size={13} /> የአባላት ተግባራት ፍጠር
                  </button>
                </div>
              ))
            )}

            {data.members.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontWeight: 600, margin: "12px 0 6px", fontSize: 13 }}>የአባላት ተግባራት</div>
                {data.members.map((m) => (
                  <div key={m.id} style={{ marginBottom: 8 }}>
                    <div className="flex-between" style={{ padding: "0 2px" }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{m.full_name}</span>
                      <span className="chip chip-neutral" style={{ fontSize: 10 }}>{m.position || "የቡድን አባል"}</span>
                    </div>
                    {m.tasks.length === 0 ? (
                      <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "2px 2px" }}>እስካሁን ተግባር የለም።</div>
                    ) : (
                      m.tasks.map((t) => (
                        <div key={t.id} className="goal-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ flex: 1, fontSize: 13 }}>{t.title}</span>
                            <span className={TASK_STATUS[t.status] || "chip chip-neutral"} style={{ fontSize: 10 }}>
                              {statusLabel(t.status)}
                            </span>
                            {t.kpi_pct != null && (
                              <span className="chip chip-indigo" style={{ fontSize: 10 }}>KPI {t.kpi_pct}%</span>
                            )}
                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>{t.progress_pct}%</span>
                          </div>
                          {(t.kpis || []).length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {t.kpis.map((k) => (
                                <span key={k.id} className="chip chip-neutral" style={{ fontSize: 10 }}>
                                  {k.name}: {k.target_value ?? "—"}
                                  {k.unit ? ` ${k.unit}` : ""}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <PlanPerformanceTable tierLabel="ቡድን" />

      {/* Activities linked to this team's plans by the department */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-title">
          የቡድን ተግባራት
          <span className="chip chip-neutral">በመምሪያ የተመደበ</span>
        </div>
        <div className="card-sub">
          መምሪያው በዕቅዶችዎ ላይ የመደባቸው ተግባራት፤ እያንዳንዱን ወደ የአባል ተግባር ያውርዱ።
        </div>
        {!data || (data.team_activities || []).length === 0 ? (
          <div style={{ padding: "10px 0", fontSize: 13, color: "var(--text-dim)" }}>
            እስካሁን ለቡድንዎ ተግባር አልተመደበም።
          </div>
        ) : (
          data.team_activities.map((a) => (
            <div key={a.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, marginBottom: 10 }}>
              <div className="flex-between">
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{a.title}</span>
                  {a.program_name && (
                    <span className="chip chip-indigo" style={{ fontSize: 10 }}>{a.program_name}</span>
                  )}
                  {a.strategic_goal_title && (
                    <span className="chip chip-neutral" style={{ fontSize: 10 }}>ከ {a.strategic_goal_title}</span>
                  )}
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>{a.progress_pct}%</span>
              </div>

              {(a.children || []).length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", marginBottom: 4 }}>
                    የአባላት ተግባራት ({a.children.length})
                  </div>
                  {a.children.map((c) => (
                    <div key={c.id} className="goal-row" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ flex: 1, fontSize: 13 }}>{c.title}</span>
                      <span className="chip chip-neutral" style={{ fontSize: 10 }}>{c.assignee_name || "አልተመደበም"}</span>
                      <span className={TASK_STATUS[c.status] || "chip chip-neutral"} style={{ fontSize: 10 }}>{statusLabel(c.status)}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>{c.progress_pct}%</span>
                    </div>
                  ))}
                </div>
              )}

              <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} onClick={() => setDrillActivity(a)}>
                <Icons.plus size={13} /> ወደ የአባል ተግባር አውርድ
              </button>
            </div>
          ))
        )}
      </div>

      {drillActivity && (
        <Modal onClose={() => setDrillActivity(null)}>
          <div className="modal-head">
            <div className="modal-title">ወደ የአባል ተግባር ከፋፍል</div>
            <button className="modal-close" onClick={() => setDrillActivity(null)}>✕</button>
          </div>
          <div className="modal-body">
            <div style={{ marginBottom: 16, padding: 12, background: "var(--slate-bg)", borderRadius: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{drillActivity.title}</div>
              <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>
                ለአንዱ የቡድን አባልዎ ግልጽ ተግባር ይመድቡ።
              </div>
            </div>
            <form onSubmit={drillDown}>
              <div className="field">
                <label>አባል</label>
                <select value={drillAssignee} onChange={(e) => setDrillAssignee(e.target.value || "")} required>
                  <option value="">አባል ይምረጡ…</option>
                  {data.members.map((m) => <option key={m.id} value={m.id}>{m.full_name}{m.position ? ` (${m.position})` : ""}</option>)}
                </select>
              </div>
              <div className="field">
                <label>የተግባር ርዕስ</label>
                <input value={drillTitle} onChange={(e) => setDrillTitle(e.target.value)} required placeholder="ለምሳሌ፦ የመስክ ምርመራ ያካሂዱ" />
              </div>
              <button className="btn btn-primary" type="submit" disabled={drillSaving || !drillAssignee || !drillTitle.trim()}>
                {drillSaving ? <><Icons.spinner size={15} /> በመመደብ ላይ…</> : "ተግባር ለአባል መድብ"}
              </button>
            </form>
          </div>
        </Modal>
      )}

      {target && (
        <Modal onClose={() => setTarget(null)}>
          <div className="modal-head">
            <div className="modal-title">የአባላት ተግባራትን አዘጋጅ</div>
            <button className="modal-close" onClick={() => setTarget(null)}>✕</button>
          </div>
          <div className="modal-body">
            <div style={{ marginBottom: 16, padding: 12, background: "var(--slate-bg)", borderRadius: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{target.title}</div>
              <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>
                ለእያንዳንዱ አባል አንድ የግል ተግባር — አባሉን ለመዝለል ሳጥኑን ባዶ ይተዉ። እያንዳንዱ ተግባር ቢያንስ አንድ KPI መያዝ አለበት።
              </div>
            </div>
            <form onSubmit={synthesize}>
              {items.map((item, idx) => (
                <div key={item.member_id} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{item.member_name}</div>
                  <input
                    value={item.title}
                    onChange={(e) =>
                      setItems(items.map((x, i) => (i === idx ? { ...x, title: e.target.value } : x)))
                    }
                    placeholder="ይህን አባል ለመዝለል ባዶ ይተዉ"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid var(--line-strong)",
                      fontSize: 13,
                      boxSizing: "border-box",
                    }}
                  />
                  <KpiEditor
                    kpis={item.kpis}
                    onChange={(kpis) => setItems(items.map((x, i) => (i === idx ? { ...x, kpis } : x)))}
                  />
                </div>
              ))}
              <button className="btn btn-primary" type="submit" disabled={saving}>
                {saving ? (
                  <><Icons.spinner size={15} /> በመፍጠር ላይ…</>
                ) : (
                  <><Icons.send size={15} /> {items.filter((i) => i.title && i.title.trim()).length} ተግባራት ፍጠር</>
                )}
              </button>
            </form>
          </div>
        </Modal>
      )}
    </div>
  );
}

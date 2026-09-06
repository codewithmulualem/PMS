import { useEffect, useState } from "react";
import { api } from "../api";
import { useCycle } from "../context/CycleContext";
import { useToast } from "../context/ToastContext";
import Topbar from "../components/Topbar";
import StatCard from "../components/StatCard";
import DistributionBar from "../components/DistributionBar";
import RatingBadge from "../components/RatingBadge";
import EpistemicTag from "../components/EpistemicTag";
import Skeleton from "../components/Skeleton";
import EmployeeDashboard from "./EmployeeDashboard";
import ManagerEvalModal from "../components/ManagerEvalModal";
import { Icons } from "../components/icons";

const WEEKLY_SUMMARY_KEYS = [];

function initials(name = "") {
  return name.split(" ").filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join("");
}

const AVATAR_COLORS = ["#4c5fd5", "#0e8f7e", "#b17a17", "#d64545", "#2f9e44", "#7c5cd5"];

export default function TeamDashboard({ managerId }) {
  const { cycleId, current } = useCycle();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [evalTarget, setEvalTarget] = useState(null);
  const [weeklySummary, setWeeklySummary] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api.get(`/managers/${managerId}/team-dashboard?cycle_id=${cycleId || ""}`),
      api.get("/weekly-plans/summary").catch(() => null),
    ])
      .then(([dashData, weeklyData]) => {
        if (!cancelled) {
          setData(dashData);
          if (weeklyData) setWeeklySummary(weeklyData);
        }
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [managerId, cycleId]);

  if (selected) {
    return <EmployeeDashboard employeeId={selected} backLabel="ወደ ቡድኑ ተመለስ" onBack={() => setSelected(null)} />;
  }

  if (loading && !data) return <Skeleton lines={6} height={22} />;
  if (error) return <div className="error-banner">{error}</div>;
  if (!data) return null;

  const orgDiff = data.organization_average != null && data.average_score != null
    ? data.average_score - data.organization_average
    : null;

  return (
    <div>
      <Topbar
        subtitle={`${data.team_size} በቀጥታ የሚመሩ ሰራተኞች · ${current?.name || ""}`}
      />

      <div className="stat-grid">
        <StatCard
          label="የቡድን አማካይ"
          value={data.average_score != null ? data.average_score.toFixed(1) : "—"}
          accent="var(--indigo)"
          tag="calc"
          foot={<span>ከድርጅት አማካይ ጋር <b className="mono">{orgDiff != null ? `${orgDiff >= 0 ? "+" : ""}${orgDiff.toFixed(1)}` : "—"}</b></span>}
        />
        <StatCard
          label="ከፍተኛ አፈጻጸም ያላቸው"
          value={data.high_performers.length}
          accent="var(--green)"
          tag="calc"
          foot={<span>ነጥብ ≥ 80</span>}
        />
        <StatCard
          label="ትኩረት የሚፈልጉ"
          value={data.employees_needing_attention.length}
          accent="var(--crimson)"
          tag="risk"
          foot={<span>አደጋ ላይ ያሉ ግቦች ወይም ነጥብ &lt; 60</span>}
        />
        <StatCard
          label="የሚጠብቁ ግምገማዎች"
          value={data.evaluations_pending}
          accent="var(--amber)"
          tag="risk"
          foot={<span>የአስተዳዳሪ ግምገማዎች ይቀራሉ</span>}
        />
      </div>

      {/* Weekly Plans Summary */}
      {weeklySummary && weeklySummary.summaries && weeklySummary.summaries.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">
            የዚህ ሳምንት ዕቅዶች
            <span className="chip chip-neutral">{weeklySummary.week_start} እስከ {weeklySummary.week_end}</span>
          </div>
          <div className="grid grid-2">
            {weeklySummary.summaries.map((emp) => (
              <div
                key={emp.employee_id}
                style={{
                  padding: "10px 12px",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  background: "#fbfcfe",
                }}
              >
                <div className="flex-between" style={{ marginBottom: 6 }}>
                  <div className="cell-strong">{emp.full_name}</div>
                  <div className="mono" style={{ fontSize: 12, color: "var(--text-dim)" }}>
                    {emp.done_tasks}/{emp.total_tasks} ተጠናቀዋል
                  </div>
                </div>
                <div className="meter-track">
                  <div
                    className="meter-fill"
                    style={{
                      width: `${emp.completion_pct}%`,
                      background: emp.completion_pct >= 80 ? "var(--green)" :
                                  emp.completion_pct >= 50 ? "var(--indigo)" : "var(--amber)",
                    }}
                  />
                </div>
                {emp.tasks.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 12 }}>
                    {emp.tasks.slice(0, 3).map((t) => (
                      <div key={t.id} style={{
                        padding: "3px 0",
                        color: t.status === "done" ? "var(--text-faint)" : "var(--text)",
                        textDecoration: t.status === "done" ? "line-through" : "none",
                      }}>
                        {t.status === "done" ? "✓" : "○"} {t.title}
                      </div>
                    ))}
                    {emp.tasks.length > 3 && (
                      <div style={{ color: "var(--text-faint)", marginTop: 2 }}>
                        +{emp.tasks.length - 3} ተጨማሪ
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-2">
        <div className="card">
          <div className="card-title">የደረጃ ስርጭት <EpistemicTag kind="calc" /></div>
          <DistributionBar buckets={data.rating_distribution || []} />
        </div>
        <div className="card">
          <div className="card-title">የቡድን አጭር እይታ <EpistemicTag kind="calc" /></div>
          {data.team.length === 0 ? (
            <div className="empty-state">እስካሁን ለዚህ አስተዳዳሪ በቀጥታ የሚመሩ ሰራተኞች አልተመደቡም።</div>
          ) : (
            <div className="hbar-row" style={{ gridTemplateColumns: "1fr 90px", marginBottom: 8 }}>
              <span className="hbar-label">አማካይ ክፍት ግቦች</span>
              <span className="hbar-val">
                {(data.team.reduce((s, t) => s + t.open_goals, 0) / data.team.length).toFixed(1)}
              </span>
            </div>
          )}
          <div className="hbar-row" style={{ gridTemplateColumns: "1fr 90px", marginBottom: 8 }}>
            <span className="hbar-label">መነጻጸሪያ፦ ቡድን ከድርጅት ጋር</span>
            <span className="hbar-val">
              {data.average_score != null ? data.average_score.toFixed(1) : "—"}
              {data.organization_average != null ? ` / ${data.organization_average.toFixed(1)}` : ""}
            </span>
          </div>
          <div className="text-faint" style={{ fontSize: 12, lineHeight: 1.6 }}>
            አማካዮች የሚሰሉት ከተሰጡ ነጥቦች (KPIዎች፣ ግቦች፣ ብቃቶች፣ ባህሪ እና ፕሮግራሞች) ነው።
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          በቀጥታ የሚመሩ
          <span className="chip chip-neutral">{data.team.length} ሰዎች</span>
        </div>
        {data.team.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">👥</div>
            በቀጥታ የሚመሩ ሰራተኞች አልተገኙም። በድርጅት መዋቅር ውስጥ ሰራተኞችን ለዚህ አስተዳዳሪ ይመድቡ።
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ሰራተኛ</th>
                  <th className="num">ነጥብ</th>
                  <th>ደረጃ</th>
                  <th className="num">ክፍት ግቦች</th>
                  <th>ሁኔታ</th>
                  <th>ግምገማ</th>
                  <th className="num" />
                </tr>
              </thead>
              <tbody>
                {data.team.map((t) => {
                  const color = AVATAR_COLORS[t.employee.id % AVATAR_COLORS.length];
                  return (
                    <tr key={t.employee.id} className="clickable" onClick={() => setSelected(t.employee.id)}>
                      <td>
                        <div className="avatar-cell">
                          <div className="avatar avatar-sm" style={{ background: color }}>{initials(t.employee.full_name)}</div>
                          <div>
                            <div className="cell-strong">{t.employee.full_name}</div>
                            <div className="cell-sub">{t.employee.position}</div>
                          </div>
                        </div>
                      </td>
                      <td className="num cell-strong">{t.overall_score != null ? t.overall_score.toFixed(1) : "—"}</td>
                      <td><RatingBadge rating={t.rating} /></td>
                      <td className="num">{t.open_goals}</td>
                      <td>
                        {t.at_risk_goals > 0
                          ? <span className="chip chip-danger">{t.at_risk_goals} አደጋ ላይ</span>
                          : <span className="chip chip-success">በመንገድ ላይ</span>}
                      </td>
                      <td>
                        {t.self_assessment_submitted
                          ? <span className="chip chip-indigo">የራስ ✓</span>
                          : <span className="chip chip-neutral">የራስ —</span>}{" "}
                        {t.manager_evaluation_submitted
                          ? <span className="chip chip-success">አስተዳዳሪ ✓</span>
                          : <span className="chip chip-warn">አስተዳዳሪ —</span>}
                      </td>
                      <td className="num">
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={(e) => { e.stopPropagation(); setEvalTarget(t); }}
                        >
                          <Icons.edit size={13} /> {t.manager_evaluation_submitted ? "ግምገማ አርትዕ" : "ገምግም"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {evalTarget && (
        <ManagerEvalModal
          member={evalTarget}
          cycleId={cycleId}
          onClose={() => setEvalTarget(null)}
          onSaved={() => { setEvalTarget(null); reload(); }}
          toast={toast}
        />
      )}
    </div>
  );

  async function reload() {
    const d = await api.get(`/managers/${managerId}/team-dashboard?cycle_id=${cycleId || ""}`);
    setData(d);
  }
}


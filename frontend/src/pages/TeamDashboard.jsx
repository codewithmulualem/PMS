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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get(`/managers/${managerId}/team-dashboard?cycle_id=${cycleId || ""}`)
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [managerId, cycleId]);

  if (selected) {
    return <EmployeeDashboard employeeId={selected} backLabel="Back to team" onBack={() => setSelected(null)} />;
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
        subtitle={`${data.team_size} direct report${data.team_size === 1 ? "" : "s"} · ${current?.name || ""}`}
      />

      <div className="stat-grid">
        <StatCard
          label="Team Average"
          value={data.average_score != null ? data.average_score.toFixed(1) : "—"}
          accent="var(--indigo)"
          tag="calc"
          foot={<span>vs org average <b className="mono">{orgDiff != null ? `${orgDiff >= 0 ? "+" : ""}${orgDiff.toFixed(1)}` : "—"}</b></span>}
        />
        <StatCard
          label="High Performers"
          value={data.high_performers.length}
          accent="var(--green)"
          tag="calc"
          foot={<span>scoring ≥ 80</span>}
        />
        <StatCard
          label="Need Attention"
          value={data.employees_needing_attention.length}
          accent="var(--crimson)"
          tag="risk"
          foot={<span>at-risk goals or score &lt; 60</span>}
        />
        <StatCard
          label="Evaluations Pending"
          value={data.evaluations_pending}
          accent="var(--amber)"
          tag="risk"
          foot={<span>manager assessments outstanding</span>}
        />
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-title">Rating Distribution <EpistemicTag kind="calc" /></div>
          <DistributionBar buckets={data.rating_distribution || []} />
        </div>
        <div className="card">
          <div className="card-title">Team Snapshot <EpistemicTag kind="calc" /></div>
          {data.team.length === 0 ? (
            <div className="empty-state">No direct reports assigned to this manager yet.</div>
          ) : (
            <div className="hbar-row" style={{ gridTemplateColumns: "1fr 90px", marginBottom: 8 }}>
              <span className="hbar-label">Average open goals</span>
              <span className="hbar-val">
                {(data.team.reduce((s, t) => s + t.open_goals, 0) / data.team.length).toFixed(1)}
              </span>
            </div>
          )}
          <div className="hbar-row" style={{ gridTemplateColumns: "1fr 90px", marginBottom: 8 }}>
            <span className="hbar-label">Benchmark: team vs org</span>
            <span className="hbar-val">
              {data.average_score != null ? data.average_score.toFixed(1) : "—"}
              {data.organization_average != null ? ` / ${data.organization_average.toFixed(1)}` : ""}
            </span>
          </div>
          <div className="text-faint" style={{ fontSize: 12, lineHeight: 1.6 }}>
            Averages are calculated from scored components (KPIs, goals, competencies, behavior, programs).
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          Direct Reports
          <span className="chip chip-neutral">{data.team.length} people</span>
        </div>
        {data.team.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">👥</div>
            No direct reports found. Assign employees to this manager in Organization Setup.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th className="num">Score</th>
                  <th>Rating</th>
                  <th className="num">Open Goals</th>
                  <th>Status</th>
                  <th>Assessment</th>
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
                          ? <span className="chip chip-danger">{t.at_risk_goals} at risk</span>
                          : <span className="chip chip-success">on track</span>}
                      </td>
                      <td>
                        {t.self_assessment_submitted
                          ? <span className="chip chip-indigo">self ✓</span>
                          : <span className="chip chip-neutral">self —</span>}{" "}
                        {t.manager_evaluation_submitted
                          ? <span className="chip chip-success">manager ✓</span>
                          : <span className="chip chip-warn">manager —</span>}
                      </td>
                      <td className="num">
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={(e) => { e.stopPropagation(); setEvalTarget(t); }}
                        >
                          <Icons.edit size={13} /> {t.manager_evaluation_submitted ? "Edit eval" : "Assess"}
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


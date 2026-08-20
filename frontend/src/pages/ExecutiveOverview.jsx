import { useEffect, useState } from "react";
import { api } from "../api";
import { useCycle } from "../context/CycleContext";
import Topbar from "../components/Topbar";
import StatCard from "../components/StatCard";
import DistributionBar from "../components/DistributionBar";
import BarList from "../components/BarList";
import TrendChart from "../components/TrendChart";
import EpistemicTag from "../components/EpistemicTag";
import Skeleton from "../components/Skeleton";
import EmployeeDashboard from "./EmployeeDashboard";
import { Icons } from "../components/icons";

function initials(name = "") {
  return name.split(" ").filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join("");
}

const DEPT_COLORS = ["#4c5fd5", "#0e8f7e", "#b17a17", "#7c5cd5", "#d64545", "#2f9e44"];

export default function ExecutiveOverview() {
  const { cycleId, current } = useCycle();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [dept, setDept] = useState(null);        // department drill-down
  const [employeeId, setEmployeeId] = useState(null);

  async function load() {
    setError(null);
    try {
      const d = await api.get(`/executive/overview?cycle_id=${cycleId || ""}`);
      setData(d);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleId]);

  if (employeeId) {
    return <EmployeeDashboard employeeId={employeeId} backLabel="Back to department" onBack={() => setEmployeeId(null)} />;
  }

  if (dept) {
    return (
      <DepartmentView
        dept={dept}
        onBack={() => setDept(null)}
        onSelect={setEmployeeId}
        cycleLabel={current?.name}
      />
    );
  }

  if (error) return <div className="error-banner">{error}</div>;
  if (!data) return <Skeleton lines={8} height={22} />;

  const trendPoints = (data.org_trend || []).map((t) => ({
    label: (t.cycle_name || "").split(" ")[0],
    value: t.avg_score,
  }));
  const avgDelta = trendPoints.length >= 2
    ? Number(trendPoints[trendPoints.length - 1].value) - Number(trendPoints[trendPoints.length - 2].value)
    : null;

  const deptItems = data.by_department
    .filter((d) => d.headcount > 0)
    .map((d, i) => ({
      label: d.department,
      value: d.avg_score,
      color: DEPT_COLORS[i % DEPT_COLORS.length],
      sub: `${d.headcount} people`,
      valueText: d.avg_score != null ? Number(d.avg_score).toFixed(1) : "—",
    }));

  return (
    <div>
      <Topbar subtitle={`Organization-wide performance intelligence · ${current?.name || ""}`} />

      <div className="stat-grid">
        <StatCard
          label="Organization Average"
          value={data.organization_average_score != null ? data.organization_average_score.toFixed(1) : "—"}
          accent="var(--indigo)"
          tag="calc"
          foot={<span>{data.employees_scored} employees scored this cycle</span>}
        />
        <StatCard
          label="Rating Distribution"
          value={data.rating_distribution.length}
          accent="var(--green)"
          tag="calc"
          foot={<span>rating bands populated</span>}
        />
        <StatCard
          label="Departments"
          value={data.by_department.length}
          accent="var(--teal)"
          foot={<span>organizational units tracked</span>}
        />
        <StatCard
          label="Org Trend"
          value={avgDelta != null ? `${avgDelta >= 0 ? "+" : ""}${avgDelta.toFixed(1)}` : "—"}
          accent={avgDelta != null && avgDelta < 0 ? "var(--crimson)" : "var(--amber)"}
          tag="calc"
          foot={<span>vs previous cycle</span>}
        />
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-title">Organization Trend <EpistemicTag kind="calc" /></div>
          {trendPoints.length >= 2 ? (
            <TrendChart points={trendPoints} color="var(--indigo)" />
          ) : (
            <div className="empty-state">More closed cycles are needed to plot an organization trend.</div>
          )}
        </div>

        <div className="card">
          <div className="card-title">Rating Distribution <EpistemicTag kind="calc" /></div>
          <DistributionBar buckets={data.rating_distribution || []} />
          <div className="divider" />
          <div className="card-title">Lowest-Achieving KPIs <EpistemicTag kind="fact" /></div>
          <BarList
            items={data.lowest_achieving_kpis.map((k) => ({
              label: k.name,
              value: k.avg_achievement,
              valueText: k.avg_achievement != null ? `${Math.round(k.avg_achievement)}%` : "—",
            }))}
            color="var(--crimson)"
          />
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          Performance by Department
          <span className="chip chip-neutral">click to drill down</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "4px 32px" }}>
          {deptItems.map((d) => (
            <div key={d.label} className="hbar-row" style={{ cursor: "pointer" }} onClick={() => {
              const deptRow = data.by_department.find((x) => x.department === d.label);
              setDept({ ...deptRow });
            }}>
              <div className="hbar-label">
                {d.label}
                {d.sub && <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{d.sub}</div>}
              </div>
              <div className="hbar-track">
                <div className="hbar-fill" style={{ width: `${Math.min(100, d.value || 0)}%`, background: d.color }} />
              </div>
              <div className="hbar-val">{d.valueText}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DepartmentView({ dept, onBack, onSelect, cycleLabel }) {
  const [employees, setEmployees] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/departments/${dept.department_id}/employees`)
      .then(setEmployees)
      .catch((e) => setError(e.message));
  }, [dept]);

  return (
    <div>
      <Topbar
        title={dept.department}
        subtitle={`${dept.headcount} people · ${cycleLabel || ""}`}
        onBack={onBack}
        backLabel="Executive Overview"
      />
      {error && <div className="error-banner">{error}</div>}
      {!employees && <Skeleton lines={6} height={22} />}
      {employees && (
        <div className="card">
          <div className="card-title">People <EpistemicTag kind="fact" /></div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Employee</th><th>Position</th><th>Grade</th><th>Manager</th><th className="num" /></tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id} className="clickable" onClick={() => onSelect(e.id)}>
                    <td>
                      <div className="avatar-cell">
                        <div className="avatar avatar-sm" style={{ background: "#4c5fd5" }}>{initials(e.full_name)}</div>
                        <span className="cell-strong">{e.full_name}</span>
                      </div>
                    </td>
                    <td>{e.position}</td>
                    <td className="mono">{e.job_grade}</td>
                    <td>{e.manager_name || "—"}</td>
                    <td className="num"><Icons.external size={14} className="text-faint" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

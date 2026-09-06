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
import { scopeLabel, statusLabel } from "../i18n";

function initials(name = "") {
  return name.split(" ").filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join("");
}

const DEPT_COLORS = ["#4c5fd5", "#0e8f7e", "#b17a17", "#7c5cd5", "#d64545", "#2f9e44"];

export default function ExecutiveOverview() {
  const { cycleId, current } = useCycle();
  const [data, setData] = useState(null);
  const [weekly, setWeekly] = useState(null);
  const [grand, setGrand] = useState(null);
  const [error, setError] = useState(null);
  const [dept, setDept] = useState(null);        // department drill-down
  const [employeeId, setEmployeeId] = useState(null);

  async function load() {
    setError(null);
    try {
      const [d, w, g] = await Promise.all([
        api.get(`/executive/overview?cycle_id=${cycleId || ""}`),
        api.get("/weekly-plans/summary"),
        api.get("/tiers/grand-plan"),
      ]);
      setData(d);
      setWeekly(w.summaries);
      setGrand(g);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleId]);

  if (employeeId) {
    return <EmployeeDashboard employeeId={employeeId} backLabel="ወደ መምሪያው ተመለስ" onBack={() => setEmployeeId(null)} />;
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
      <Topbar subtitle={`የመላ ድርጅቱ የአፈጻጸም መረጃ · ${current?.name || ""}`} />

      <div className="stat-grid">
        <StatCard
          label="የድርጅት አማካይ"
          value={data.organization_average_score != null ? data.organization_average_score.toFixed(1) : "—"}
          accent="var(--indigo)"
          tag="calc"
          foot={<span>{data.employees_scored} ሰራተኞች በዚህ ዑደት ነጥብ አግኝተዋል</span>}
        />
        <StatCard
          label="የደረጃ ስርጭት"
          value={data.rating_distribution.length}
          accent="var(--green)"
          tag="calc"
          foot={<span>የደረጃ ምድቦች ተሞልተዋል</span>}
        />
        <StatCard
          label="መምሪያዎች"
          value={data.by_department.length}
          accent="var(--teal)"
          foot={<span>የድርጅት ክፍሎች እየተከታተሉ ነው</span>}
        />
        <StatCard
          label="የድርጅት አዝማሚያ"
          value={avgDelta != null ? `${avgDelta >= 0 ? "+" : ""}${avgDelta.toFixed(1)}` : "—"}
          accent={avgDelta != null && avgDelta < 0 ? "var(--crimson)" : "var(--amber)"}
          tag="calc"
          foot={<span>ከቀደመው ዑደት ጋር</span>}
        />
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-title">የድርጅት አዝማሚያ <EpistemicTag kind="calc" /></div>
          {trendPoints.length >= 2 ? (
            <TrendChart points={trendPoints} color="var(--indigo)" />
          ) : (
            <div className="empty-state">የድርጅት አዝማሚያን ለማሳየት ተጨማሪ የተዘጉ ዑደቶች ያስፈልጋሉ።</div>
          )}
        </div>

        <div className="card">
          <div className="card-title">የደረጃ ስርጭት <EpistemicTag kind="calc" /></div>
          <DistributionBar buckets={data.rating_distribution || []} />
          <div className="divider" />
          <div className="card-title">ዝቅተኛ ስኬት ያላቸው KPIዎች <EpistemicTag kind="fact" /></div>
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
          በመምሪያ የተከፋፈለ አፈጻጸም
          <span className="chip chip-neutral">ለዝርዝር እይታ ይጫኑ</span>
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

      <WeeklySummaryCard summaries={weekly} />
      <GrandPlanCard grand={grand} />
    </div>
  );
}

function GrandPlanUnitRow({ node, depth }) {
  const [open, setOpen] = useState(depth < 2);
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingLeft: depth * 20 }}>
        <button
          onClick={() => setOpen(!open)}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--text-dim)", width: 18, textAlign: "left" }}
        >
          {open ? "▾" : "▸"}
        </button>
        <span style={{ flex: 1, fontWeight: depth === 0 ? 700 : 600 }}>
          {node.name}
          {node.member_count > 0 && <span style={{ fontWeight: 400, color: "var(--text-dim)", fontSize: 12 }}> · {node.member_count} ሰዎች</span>}
        </span>
        {node.avg_eval_score != null && (
          <span className="chip chip-indigo" style={{ fontSize: 11 }}>
            ግምገማ {Number(node.avg_eval_score).toFixed(1)}
          </span>
        )}
        <div style={{ width: 120 }}>
          <div style={{ height: 7, background: "var(--neutral-bg)", borderRadius: 999, overflow: "hidden" }}>
            <div style={{ width: `${node.completion_pct}%`, height: "100%", background: "var(--green)", borderRadius: 999 }} />
          </div>
        </div>
        <span className="chip chip-success" style={{ fontSize: 11 }}>ተግባራት {node.completion_pct}%</span>
      </div>
      {open && (
        <div>
          {node.children.map((c) => <GrandPlanUnitRow key={c.unit_id} node={c} depth={depth + 1} />)}
        </div>
      )}
    </div>
  );
}

function GrandPlanCard({ grand }) {
  if (!grand) return null;
  const tree = grand.tree;
  const activeGoals = (grand.goals || []).filter((g) => g.status !== "cancelled");
  const goalPct = activeGoals.length > 0
    ? Math.round(activeGoals.reduce((s, g) => s + (g.progress_pct || 0), 0) / activeGoals.length)
    : 0;

  return (
    <div className="card">
      <div className="card-title">ዋና ዕቅድ <EpistemicTag kind="calc" /></div>
      <div className="card-sub">
        ስትራቴጂካዊ ግቦች እና የሳምንታዊ ተግባራት ማጠናቀቂያ በዳይሬክቶሬት እና በመምሪያ ተደምረዋል።
      </div>

      <div className="stat-row" style={{ display: "flex", gap: 32, margin: "16px 0" }}>
        <StatCard label="ስትራቴጂካዊ ግቦች" value={activeGoals.length} accent="var(--teal)" tag="epistemic" foot={<span>{tree.member_count} ሰዎች በወሰኑ ውስጥ</span>} />
        <StatCard label="የግብ አፈጻጸም" value={`${goalPct}%`} accent="var(--green)" tag="calc" />
        <StatCard label="የድርጅት ተግባር ማጠናቀቂያ" value={`${tree.completion_pct}%`} accent="var(--indigo)" tag="calc" foot={<span>{tree.done_tasks} ከ {tree.total_tasks} ተግባራት</span>} />
      </div>

      {(activeGoals.length > 0) && (
        <>
          <div style={{ fontSize: 13, color: "var(--text-dim)", margin: "12px 0 6px" }}>ስትራቴጂካዊ ግቦች</div>
          {activeGoals
            .filter((g) => g.scope !== "individual")
            .map((g) => (
              <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", fontSize: 13 }}>
                <span style={{ flex: 1 }}>
                  {g.title}
                  {g.org_unit_name && <span className="chip chip-neutral" style={{ fontSize: 10 }}>{g.org_unit_name}</span>}
                  {g.program_name && <span className="chip chip-neutral" style={{ fontSize: 10 }}>በ {g.program_name}</span>}
                </span>
                <span className="chip chip-indigo" style={{ fontSize: 10 }}>{scopeLabel(g.scope)}</span>
                <span className={g.status === "completed" ? "chip chip-success" : g.status === "active" ? "chip chip-indigo" : "chip chip-neutral"} style={{ fontSize: 10 }}>{statusLabel(g.status)}</span>
                <span style={{ fontSize: 12, width: 48, textAlign: "right" }}>{g.progress_pct != null ? `${Math.round(g.progress_pct)}%` : "—"}</span>
              </div>
            ))}
        </>
      )}

      <div style={{ fontSize: 13, color: "var(--text-dim)", margin: "14px 0 6px" }}>በክፍል የተግባር ማጠናቀቂያ</div>
      <GrandPlanUnitRow node={tree} depth={0} />
    </div>
  );
}

function WeeklySummaryCard({ summaries }) {
  if (!summaries) return null;
  const withTasks = summaries.filter((s) => s.total_tasks > 0);
  const total = withTasks.reduce((acc, s) => acc + s.total_tasks, 0);
  const done = withTasks.reduce((acc, s) => acc + s.done_tasks, 0);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const planned = withTasks.length;

  return (
    <div className="card">
      <div className="card-title">
        የቡድን ሳምንታዊ ዕቅዶች
        <span className="chip chip-neutral">ይህ ሳምንት</span>
      </div>
      {withTasks.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🗓️</div>
          በዚህ ሳምንት እስካሁን ምንም ሰራተኛ ሳምንታዊ ዕቅድ አልፈጠረም።
        </div>
      ) : (
        <>
          <div className="stat-row" style={{ display: "flex", gap: 32, marginBottom: 16 }}>
            <StatCard label="የተፈጠሩ ዕቅዶች" value={planned} accent="var(--teal)" tag="calc" />
            <StatCard label="ጠቅላላ አፈጻጸም" value={`${pct}%`} accent="var(--green)" tag="calc" foot={<span>{done} ከ {total} ተግባራት ተጠናቀዋል</span>} />
          </div>
          <BarList
            items={withTasks
              .sort((a, b) => a.completion_pct - b.completion_pct)
              .map((s) => ({
                label: s.full_name,
                value: s.completion_pct,
                valueText: s.completion_pct != null ? `${Math.round(s.completion_pct)}%` : "—",
                sub: `${s.done_tasks}/${s.total_tasks} ተግባራት`,
              }))}
            color="var(--indigo)"
          />
        </>
      )}
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
        subtitle={`${dept.headcount} ሰዎች · ${cycleLabel || ""}`}
        onBack={onBack}
        backLabel="የአስፈፃሚ እይታ"
      />
      {error && <div className="error-banner">{error}</div>}
      {!employees && <Skeleton lines={6} height={22} />}
      {employees && (
        <div className="card">
          <div className="card-title">ሰዎች <EpistemicTag kind="fact" /></div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>ሰራተኛ</th><th>የሥራ መደብ</th><th>ደረጃ</th><th>አስተዳዳሪ</th><th className="num" /></tr>
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

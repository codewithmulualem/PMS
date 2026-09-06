import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useCycle } from "../context/CycleContext";
import { useToast } from "../context/ToastContext";
import Skeleton from "../components/Skeleton";
import { Icons } from "../components/icons";

const DAYS = [
  { value: 1, label: "ሰኞ" },
  { value: 2, label: "ማክሰኞ" },
  { value: 3, label: "ረቡዕ" },
  { value: 4, label: "ሐሙስ" },
  { value: 5, label: "ዓርብ" },
];

const STATUS_STYLE = {
  todo: { background: "var(--neutral-bg)", color: "var(--text-dim)" },
  in_progress: { background: "var(--indigo-bg)", color: "var(--indigo)" },
  done: { background: "var(--green-bg)", color: "var(--green)" },
};

const SCOPE_LABEL = { annual: "ዓመታዊ", quarterly: "የሩብ ዓመት", team: "የቡድን" };

function StatusChip({ status, onChange }) {
  return (
    <select
      value={status}
      onChange={(e) => onChange(e.target.value)}
      style={{
        ...STATUS_STYLE[status],
        border: "none",
        borderRadius: 999,
        padding: "4px 10px",
        fontSize: 11,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      <option value="todo">ያልተጀመረ</option>
      <option value="in_progress">በሂደት ላይ</option>
      <option value="done">ተጠናቋል</option>
    </select>
  );
}

function AssignedToMe({ linkedIds, onAddToWeek }) {
  const [assigned, setAssigned] = useState(null);
  const [error, setError] = useState(null);
  const [actuals, setActuals] = useState({});
  const [savingId, setSavingId] = useState(null);

  const load = useCallback(() => {
    api
      .get("/strategic-goals/assigned")
      .then(setAssigned)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveActual(k) {
    const val = actuals[k.id];
    if (val === undefined || val === "") return;
    setSavingId(k.id);
    try {
      await api.put(`/strategic-goals/kpis/${k.id}`, { actual_value: Number(val) });
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingId(null);
    }
  }

  if (assigned === null && !error) return <Skeleton lines={3} height={18} />;
  return (
    <div className="card">
      <div className="card-title">
        ለእኔ የተመደቡ
        <span className="chip chip-indigo">የግል ተግባራት</span>
      </div>
      <div className="card-sub">
        የቡድን መሪዎ የመደበልዎትን ተግባራት ወደዚህ ሳምንት ያክሉ እና የKPI አፈጻጸም ይመዝግቡ።
      </div>
      {error ? (
        <div className="error-banner">{error}</div>
      ) : assigned.length === 0 ? (
        <div className="empty-state" style={{ padding: "20px 12px" }}>
          <div className="empty-icon">🎯</div>
          እስካሁን ምንም አልተመደበልዎትም።
        </div>
      ) : (
        <div>
          {assigned.map((t) => {
            const added = linkedIds.has(t.id);
            return (
              <div key={t.id} className="goal-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ flex: 1, fontSize: 13 }}>{t.title}</span>
                  {(t.breadcrumb || []).map((b) => (
                    <span key={b.id} className="chip chip-neutral" style={{ fontSize: 10 }}>
                      {SCOPE_LABEL[b.scope] || b.scope} · {b.title}
                    </span>
                  ))}
                  {t.kpi_pct != null && (
                    <span className="chip chip-indigo" style={{ fontSize: 11 }}>KPI {t.kpi_pct}%</span>
                  )}
                  <span className="chip chip-success" style={{ fontSize: 11 }}>{t.progress_pct}%</span>
                  {added ? (
                    <span className="chip chip-success" style={{ fontSize: 10 }}>✓ በሳምንቱ ውስጥ</span>
                  ) : (
                    <button className="btn btn-secondary btn-sm" onClick={() => onAddToWeek(t)}>
                      <Icons.plus size={13} /> ወደ ሳምንቱ ጨምር
                    </button>
                  )}
                </div>
                {(t.kpis || []).length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {t.kpis.map((k) => (
                      <span key={k.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <span className="chip chip-neutral" style={{ fontSize: 10 }}>
                          {k.name}
                          {k.kpi_type === "percentage" ? " %" : ""}
                        </span>
                        {k.target_value != null && (
                          <span className="chip chip-neutral" style={{ fontSize: 10 }}>
                            ዒላማ፦ {k.target_value}{k.unit ? ` ${k.unit}` : ""}
                          </span>
                        )}
                        <input
                          type="number"
                          value={actuals[k.id] ?? (k.actual_value ?? "")}
                          onChange={(e) => setActuals((p) => ({ ...p, [k.id]: e.target.value }))}
                          placeholder="ትክክለኛ"
                          style={{
                            width: 70,
                            padding: "4px 6px",
                            borderRadius: 6,
                            border: "1px solid var(--line-strong)",
                            fontSize: 12,
                          }}
                        />
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => saveActual(k)}
                          disabled={savingId === k.id || (actuals[k.id] === undefined && k.actual_value == null)}
                        >
                          {savingId === k.id ? <Icons.spinner size={12} /> : "አስቀምጥ"}
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, onChangeStatus, onChangeDay }) {
  return (
    <div
      className="goal-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        background: task.status === "done" ? "var(--green-bg)" : "transparent",
        borderRadius: 8,
      }}
    >
      <input
        type="checkbox"
        checked={task.status === "done"}
        onChange={() => onChangeStatus(task.id, task.status === "done" ? "in_progress" : "done")}
        style={{ width: 18, height: 18, accentColor: "var(--green)" }}
      />
      <span
        style={{
          flex: 1,
          fontSize: 14,
          textDecoration: task.status === "done" ? "line-through" : "none",
          color: task.status === "done" ? "var(--text-dim)" : "var(--text)",
        }}
      >
        {task.title}
      </span>
      {task.strategic_goal_title && (
        <span className="chip chip-indigo" style={{ fontSize: 10 }}>
          {task.strategic_goal_title}
        </span>
      )}
      <select
        value={task.day_of_week || ""}
        onChange={(e) => onChangeDay(task.id, e.target.value ? Number(e.target.value) : null)}
        style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid var(--line-strong)", fontSize: 12 }}
        title="ለሳምንቱ ቀን መድብ"
      >
        <option value="">ቀን የለም</option>
        {DAYS.map((d) => (
          <option key={d.value} value={d.value}>{d.label}</option>
        ))}
      </select>
      <StatusChip status={task.status} onChange={(s) => onChangeStatus(task.id, s)} />
    </div>
  );
}

function Progress({ done, total }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 150 }}>
      <div style={{ flex: 1, height: 8, background: "var(--neutral-bg)", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: pct === 100 ? "var(--green)" : "var(--indigo)", borderRadius: 999 }} />
      </div>
      <span className="chip chip-success" style={{ fontSize: 11, minWidth: 44, textAlign: "center" }}>
        {done}/{total}
      </span>
    </div>
  );
}

function AddTaskBar({ value, day, onValueChange, onDayChange, onAdd, saving }) {
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
      <input
        type="text"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && value.trim() && onAdd()}
        placeholder="ተግባር ይጨምሩ..."
        style={{
          flex: 1,
          padding: "10px 14px",
          border: "1px solid var(--line-strong)",
          borderRadius: 10,
          fontSize: 14,
        }}
        disabled={saving}
      />
      <select
        value={day ?? ""}
        onChange={(e) => onDayChange(e.target.value ? Number(e.target.value) : null)}
        style={{ padding: "4px 8px", borderRadius: 8, border: "1px solid var(--line-strong)", fontSize: 13 }}
        title="ለአንድ ቀን መርሐ ግብር አውጣ"
      >
        <option value="">ቀን የለም</option>
        {DAYS.map((d) => (
          <option key={d.value} value={d.value}>{d.label}</option>
        ))}
      </select>
      <button className="btn btn-primary btn-sm" onClick={onAdd} disabled={!value.trim() || saving}>
        {saving ? "በመጨመር ላይ..." : <><Icons.plus size={14} /> ጨምር</>}
      </button>
    </div>
  );
}

export default function WeeklyTasks() {
  const { cycleId } = useCycle();
  const toast = useToast();
  const [view, setView] = useState("daily");
  const [weekPlan, setWeekPlan] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [today, setToday] = useState(null);
  const [newTask, setNewTask] = useState("");
  const [newTaskDay, setNewTaskDay] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setError(null);
    try {
      const [weeklyData, todayRes] = await Promise.all([
        api.get("/weekly-plans/current"),
        api.get("/weekly-plans/today"),
      ]);
      setWeekPlan(weeklyData.plan);
      setTasks(weeklyData.tasks || []);
      setToday(todayRes);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleId]);

  const todayIdx = today?.day;
  const todayDefault = todayIdx >= 1 && todayIdx <= 5 ? todayIdx : null;

  async function persist(updated) {
    setTasks(updated);
    try {
      await api.post("/weekly-plans/current", { tasks: updated });
      load();
    } catch (err) {
      toast.push(err.message, "error");
    }
  }

  async function addTask() {
    if (!newTask.trim()) return;
    setSaving(true);
    try {
      const updated = [...tasks, { title: newTask.trim(), status: "todo", day_of_week: newTaskDay }];
      await api.post("/weekly-plans/current", { tasks: updated });
      setTasks(updated);
      setNewTask("");
      setNewTaskDay(null);
      toast.push("ተግባሩ ተጨምሯል", "success");
      load();
    } catch (err) {
      toast.push(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function addToWeek(goal) {
    setSaving(true);
    try {
      const updated = [
        ...tasks,
        { title: goal.title, status: "todo", day_of_week: null, strategic_goal_id: goal.id },
      ];
      await api.post("/weekly-plans/current", { tasks: updated });
      setTasks(updated);
      toast.push("ወደ ሳምንትዎ ተጨምሯል", "success");
      load();
    } catch (err) {
      toast.push(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  function setTaskStatus(taskId, status) {
    persist(tasks.map((t) => (t.id === taskId ? { ...t, status } : t)));
  }

  function setTaskDay(taskId, day) {
    persist(tasks.map((t) => (t.id === taskId ? { ...t, day_of_week: day !== undefined ? day : t.day_of_week } : t)));
  }

  const doneCount = useMemo(() => tasks.filter((t) => t.status === "done").length, [tasks]);

  const linkedIds = useMemo(
    () => new Set(tasks.filter((t) => t.strategic_goal_id).map((t) => t.strategic_goal_id)),
    [tasks]
  );

  const byDay = useMemo(() => {
    const groups = { 1: [], 2: [], 3: [], 4: [], 5: [], none: [] };
    for (const t of tasks) {
      if (t.day_of_week && groups[t.day_of_week]) groups[t.day_of_week].push(t);
      else groups.none.push(t);
    }
    return groups;
  }, [tasks]);

  if (loading && !weekPlan && !error) return <Skeleton lines={8} height={20} />;
  if (error) return <div className="error-banner">{error}</div>;

  const todayDone = (today?.today || []).filter((t) => t.status === "done").length;

  return (
    <div className="page-enter">
      {/* Assigned individual tasks from your team leader */}
      <AssignedToMe linkedIds={linkedIds} onAddToWeek={addToWeek} />

      {/* View toggle: Daily / Weekly */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <button
          className={`btn ${view === "daily" ? "btn-primary" : "btn-secondary"} btn-sm`}
          onClick={() => setView("daily")}
        >
          <Icons.clock size={14} /> ዕለታዊ
        </button>
        <button
          className={`btn ${view === "weekly" ? "btn-primary" : "btn-secondary"} btn-sm`}
          onClick={() => setView("weekly")}
        >
          <Icons.calendar size={14} /> ሳምንታዊ
        </button>
        <div style={{ flex: 1 }} />
        <span className="chip chip-neutral">
          {today?.day_name ? `${today.day_name} በዚህ ሳምንት` : "ሁሉም ተግባራት"}
        </span>
      </div>

      {view === "daily" ? (
        <div className="card">
          <div className="card-title">
            ዛሬ
            {today?.day_name && <span className="chip chip-indigo">{today.day_name}</span>}
            <div style={{ flex: 1 }} />
            <Progress done={todayDone} total={(today?.today || []).length} />
          </div>
          <div className="card-sub">
            ለዛሬ የታቀዱ ሥራዎች፤ ያልታቀዱ ተግባራትም እዚህ ይታያሉ።
          </div>

          {(today?.today || []).length === 0 ? (
            <div className="empty-state" style={{ padding: "24px 12px" }}>
              <div className="empty-icon">🗓</div>
              ለዛሬ ምንም አልታቀደም። ከታች ተግባር ይጨምሩ ወይም ወደ ሳምንታዊ እይታ ይቀይሩ።
            </div>
          ) : (
            <div>
              {(today?.today || []).map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onChangeStatus={setTaskStatus}
                  onChangeDay={setTaskDay}
                />
              ))}
            </div>
          )}

          <AddTaskBar
            value={newTask}
            day={newTaskDay ?? todayDefault}
            onValueChange={setNewTask}
            onDayChange={setNewTaskDay}
            onAdd={addTask}
            saving={saving}
          />
        </div>
      ) : (
        <div className="card">
          <div className="card-title">
            ይህ ሳምንት
            <div style={{ flex: 1 }} />
            <Progress done={doneCount} total={tasks.length} />
          </div>
          <div className="card-sub">
            {weekPlan && `ከ ${weekPlan.week_start} የሚጀምር ሳምንት · ተግባራት በታቀዱበት ቀን ተደራጅተዋል`}
          </div>

          {tasks.length === 0 ? (
            <div className="empty-state" style={{ padding: "24px 12px" }}>
              <div className="empty-icon">📝</div>
              እስካሁን ተግባር የለም። ሳምንትዎን ከታች ያቅዱ።
            </div>
          ) : (
            <div>
              {DAYS.map((d) => (
                <div key={d.value} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 600, margin: "10px 0 4px" }}>
                    {d.label}
                    <span className="chip chip-neutral" style={{ fontSize: 10, marginLeft: 6 }}>
                      {byDay[d.value].length}
                    </span>
                  </div>
                  {byDay[d.value].length === 0 ? (
                    <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "2px 12px" }}>
                      Nothing planned.
                    </div>
                  ) : (
                    byDay[d.value].map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        onChangeStatus={setTaskStatus}
                        onChangeDay={setTaskDay}
                      />
                    ))
                  )}
                </div>
              ))}
              <div>
                <div style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 600, margin: "10px 0 4px" }}>
                  Unscheduled
                  <span className="chip chip-neutral" style={{ fontSize: 10, marginLeft: 6 }}>
                    {byDay.none.length}
                  </span>
                </div>
                {byDay.none.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "2px 12px" }}>
                    Every task is scheduled.
                  </div>
                ) : (
                  byDay.none.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onChangeStatus={setTaskStatus}
                      onChangeDay={setTaskDay}
                    />
                  ))
                )}
              </div>
            </div>
          )}

          <AddTaskBar
            value={newTask}
            day={newTaskDay ?? todayDefault}
            onValueChange={setNewTask}
            onDayChange={setNewTaskDay}
            onAdd={addTask}
            saving={saving}
          />
        </div>
      )}
    </div>
  );
}

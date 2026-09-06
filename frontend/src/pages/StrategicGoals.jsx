import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import Skeleton from "../components/Skeleton";
import Modal from "../components/Modal";
import { Icons } from "../components/icons";
import { STATUS_LABELS } from "../i18n";

const STATUS_CHIP = {
  draft: "chip chip-neutral",
  active: "chip chip-indigo",
  completed: "chip chip-success",
  cancelled: "chip chip-neutral",
};

const SCOPE_LABEL = {
  annual: "ዓመታዊ",
  quarterly: "የሩብ ዓመት",
  team: "የቡድን",
  individual: "የግል",
  department: "የመምሪያ",
};

const SCOPE_COLOR = {
  annual: "var(--indigo)",
  quarterly: "var(--teal)",
  team: "var(--amber)",
  individual: "var(--slate)",
  department: "var(--violet)",
};

export default function StrategicGoals({ embedded = false }) {
  const { user } = useAuth();
  const toast = useToast();
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [createModal, setCreateModal] = useState(false);
  const [cascadeModal, setCascadeModal] = useState(null);
  const [programs, setPrograms] = useState([]);
  const [newGoal, setNewGoal] = useState({
    title: "",
    description: "",
    scope: "annual",
    quarter: "Q1",
    year: new Date().getFullYear(),
    program_id: "",
  });

  // Authorship: executive authors annual goals; only directors cascade an
  // annual into quarterly plans. Admin/executive review without authoring.
  const canCreate = user?.role === "executive";
  const canCascade = user?.role === "director";
  const compactView = ["executive", "director"].includes(user?.role);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get("/strategic-goals/tree");
      setGoals(data);
      // Expand root nodes by default
      setExpanded(new Set(data.map((g) => g.id)));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleExpand(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function openCreateModal() {
    setCreateModal(true);
    if (programs.length === 0) {
      try {
        setPrograms(await api.get("/programs/for-goals"));
      } catch (err) {
        toast.push(err.message, "error");
      }
    }
  }

  async function createGoal(e) {
    e.preventDefault();
    try {
      await api.post("/strategic-goals", {
        ...newGoal,
        owner_id: user.employee_id,
        program_id: newGoal.program_id || null,
      });
      toast.push("ስትራቴጂካዊ ግብ ተፈጥሯል", "success");
      setCreateModal(false);
      setNewGoal({ title: "", description: "", scope: "annual", quarter: "Q1", year: new Date().getFullYear(), program_id: "" });
      load();
    } catch (err) {
      toast.push(err.message, "error");
    }
  }

  async function cascadeGoal(parentGoal, assignments) {
    try {
      await api.post(`/strategic-goals/${parentGoal.id}/assign`, { assignments });
      toast.push(`${assignments.length} የልጅ ግቦች ተፈጥረዋል`, "success");
      setCascadeModal(null);
      load();
    } catch (err) {
      toast.push(err.message, "error");
    }
  }

  if (loading && goals.length === 0) return <Skeleton lines={8} height={20} />;
  if (error) return <div className="error-banner">{error}</div>;

  return (
    <div className="page-enter">
      <div className="flex-between" style={{ marginBottom: 18 }}>
        <div>
          <div className="page-title">{embedded ? "የዳይሬክቶሬት ዕቅድ ማዘጋጀት" : "ስትራቴጂካዊ ግቦች"}</div>
          <div className="page-subtitle">
            {compactView ? "ዓመታዊ → የሩብ ዓመት → የመምሪያ አፈጻጸም" : "ዓመታዊ → የሩብ ዓመት → የቡድን → የግል"}
          </div>
        </div>
        {canCreate && (
          <button className="btn btn-primary" onClick={openCreateModal}>
            <Icons.plus size={15} /> ግብ ፍጠር
          </button>
        )}
      </div>

      {goals.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-icon">🎯</div>
            እስካሁን ምንም ስትራቴጂካዊ ግብ የለም።
            {canCreate && (
              <div style={{ marginTop: 12 }}>
                <button className="btn btn-primary btn-sm" onClick={openCreateModal}>
                  የመጀመሪያውን ግብ ፍጠር
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card">
          {goals.map((goal) => (
            <GoalNode
              key={goal.id}
              goal={goal}
              expanded={expanded}
              toggleExpand={toggleExpand}
              canCreate={canCreate}
              canCascade={canCascade}
              onCascade={setCascadeModal}
            />
          ))}
        </div>
      )}

      {/* Create Goal Modal */}
      {createModal && (
        <Modal onClose={() => setCreateModal(false)}>
          <div className="modal-head">
            <div className="modal-title">ስትራቴጂካዊ ግብ ፍጠር</div>
            <button className="modal-close" onClick={() => setCreateModal(false)}>✕</button>
          </div>
          <div className="modal-body">
            <form onSubmit={createGoal}>
              <div className="field">
                <label>ርዕስ</label>
                <input
                  value={newGoal.title}
                  onChange={(e) => setNewGoal({ ...newGoal, title: e.target.value })}
                  placeholder="ለምሳሌ፦ የESIA የሥራ መዝገብን በ50% ይቀንሱ"
                  required
                />
              </div>
              <div className="field">
                <label>መግለጫ</label>
                <textarea
                  value={newGoal.description}
                  onChange={(e) => setNewGoal({ ...newGoal, description: e.target.value })}
                  placeholder="አማራጭ መግለጫ..."
                  rows={3}
                />
              </div>
              <div className="form-grid">
                <div className="field">
                  <label>ደረጃ</label>
                  <div style={{ padding: "8px 12px", border: "1px solid var(--line-strong)", borderRadius: 8, fontSize: 14, background: "var(--slate-bg)" }}>
                    ዓመታዊ
                  </div>
                </div>
                <div className="field">
                  <label>ዓመት</label>
                  <input
                    type="number"
                    value={newGoal.year}
                    onChange={(e) => setNewGoal({ ...newGoal, year: Number(e.target.value) })}
                    min="2024"
                    max="2030"
                  />
                </div>
              </div>
              <div className="field">
                <label>ምንጭ ፕሮግራም <span className="text-faint">(ዋናው ዕቅድ ከዚህ ፕሮግራም ይነሳል)</span></label>
                <select
                  value={newGoal.program_id}
                  onChange={(e) => setNewGoal({ ...newGoal, program_id: e.target.value })}
                >
                  <option value="">— ፕሮግራም የለም (ገለልተኛ ግብ) —</option>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <button className="btn btn-primary" type="submit">
                <Icons.send size={15} /> ፍጠር
              </button>
            </form>
          </div>
        </Modal>
      )}

      {/* Cascade Modal */}
      {cascadeModal && (
        <CascadeModal
          goal={cascadeModal}
          onClose={() => setCascadeModal(null)}
          onCascade={cascadeGoal}
        />
      )}
    </div>
  );
}

function GoalNode({ goal, expanded, toggleExpand, canCreate, canCascade, onCascade }) {
  const hasChildren = goal.children && goal.children.length > 0;
  const isExpanded = expanded.has(goal.id);
  const nextScope = { annual: "quarterly", quarterly: "team", team: "individual" };
  const canBreakDown = canCascade && goal.scope === "annual";

  return (
    <div style={{ marginLeft: goal.parent_id ? 20 : 0 }}>
      <div
        className="goal-row"
        style={{
          borderLeft: `3px solid ${SCOPE_COLOR[goal.scope]}`,
          paddingLeft: 12,
          marginLeft: goal.parent_id ? 0 : undefined,
        }}
      >
        <div className="goal-title" style={{ fontSize: 14 }}>
          {hasChildren ? (
            <button
              className="tree-toggle"
              onClick={() => toggleExpand(goal.id)}
              style={{ width: 20, height: 20 }}
            >
              {isExpanded ? "▼" : "▶"}
            </button>
          ) : (
            <span style={{ width: 20 }} />
          )}
          <span>{goal.title}</span>
          <span className={STATUS_CHIP[goal.status] || "chip chip-neutral"}>
            {STATUS_LABELS[goal.status] || goal.status}
          </span>
          <span
            className="chip chip-neutral"
            style={{ background: `${SCOPE_COLOR[goal.scope]}20`, color: SCOPE_COLOR[goal.scope] }}
          >
            {SCOPE_LABEL[goal.scope]}
          </span>
          {goal.program_name && (
            <span className="chip chip-neutral">በ {goal.program_name}</span>
          )}
        </div>
        <div className="goal-meta">
          {goal.owner_name && <span>ባለቤት፦ {goal.owner_name}</span>}
          {goal.assigned_name && <span>→ {goal.assigned_name}</span>}
          {goal.org_unit_name && <span>{goal.org_unit_name}</span>}
          {goal.progress_pct > 0 && <span>{goal.progress_pct}%</span>}
        </div>
        {canBreakDown && (
          <div style={{ marginTop: 8 }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => onCascade(goal)}
            >
              <Icons.plus size={13} /> ወደ {SCOPE_LABEL[nextScope[goal.scope]]} ግቦች አውርድ
            </button>
          </div>
        )}
      </div>
      {isExpanded && hasChildren && (
        <div>
          {goal.children.map((child) => (
            <GoalNode
              key={child.id}
              goal={child}
              expanded={expanded}
              toggleExpand={toggleExpand}
              canCreate={canCreate}
              canCascade={canCascade}
              onCascade={onCascade}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CascadeModal({ goal, onClose, onCascade }) {
  const [items, setItems] = useState([
    { title: "", description: "", assigned_to_id: "", quarter: "Q1", year: new Date().getFullYear() },
  ]);

  const nextScope = { annual: "quarterly", quarterly: "team", team: "individual" }[goal.scope];

  function addItem() {
    setItems([...items, { title: "", description: "", assigned_to_id: "", quarter: "Q1", year: new Date().getFullYear() }]);
  }

  function updateItem(idx, field, value) {
    const updated = [...items];
    updated[idx] = { ...updated[idx], [field]: value };
    setItems(updated);
  }

  function removeItem(idx) {
    setItems(items.filter((_, i) => i !== idx));
  }

  function submit(e) {
    e.preventDefault();
    const valid = items.filter((i) => i.title.trim());
    if (valid.length === 0) return;
    onCascade(goal, valid);
  }

  return (
    <Modal onClose={onClose}>
      <div className="modal-head">
        <div className="modal-title">ግብን ወደ ታች አውርድ</div>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>
      <div className="modal-body">
        <div style={{ marginBottom: 16, padding: 12, background: "var(--slate-bg)", borderRadius: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{goal.title}</div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>
            {SCOPE_LABEL[nextScope]} ግቦች እየተፈጠሩ ነው
          </div>
        </div>

        <form onSubmit={submit}>
          {items.map((item, idx) => (
            <div key={idx} style={{ marginBottom: 16, padding: 12, border: "1px solid var(--line)", borderRadius: 8 }}>
              <div className="flex-between" style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>ግብ {idx + 1}</div>
                {items.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => removeItem(idx)}
                  >
                    አስወግድ
                  </button>
                )}
              </div>
              <div className="field">
                <label>ርዕስ</label>
                <input
                  value={item.title}
                  onChange={(e) => updateItem(idx, "title", e.target.value)}
                  placeholder="የግብ ርዕስ"
                  required
                />
              </div>
              <div className="form-grid">
                <div className="field">
                  <label>ሩብ ዓመት</label>
                  <select
                    value={item.quarter}
                    onChange={(e) => updateItem(idx, "quarter", e.target.value)}
                  >
                    <option value="Q1">1ኛ ሩብ</option>
                    <option value="Q2">2ኛ ሩብ</option>
                    <option value="Q3">3ኛ ሩብ</option>
                    <option value="Q4">4ኛ ሩብ</option>
                  </select>
                </div>
                <div className="field">
                  <label>ዓመት</label>
                  <input
                    type="number"
                    value={item.year}
                    onChange={(e) => updateItem(idx, "year", Number(e.target.value))}
                    min="2024"
                    max="2030"
                  />
                </div>
              </div>
              <div className="field">
                <label>መግለጫ (አማራጭ)</label>
                <textarea
                  value={item.description}
                  onChange={(e) => updateItem(idx, "description", e.target.value)}
                  placeholder="መግለጫ"
                  rows={2}
                />
              </div>
            </div>
          ))}

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={addItem}
            style={{ marginBottom: 16 }}
          >
            <Icons.plus size={13} /> ሌላ ግብ ጨምር
          </button>

          <button className="btn btn-primary" type="submit">
            <Icons.send size={15} /> {items.filter((i) => i.title.trim()).length} ግቦችን ፍጠር
          </button>
        </form>
      </div>
    </Modal>
  );
}

import { useEffect, useState } from "react";
import { api } from "../api";
import { useToast } from "../context/ToastContext";
import Topbar from "../components/Topbar";
import EpistemicTag from "../components/EpistemicTag";
import { Icons } from "../components/icons";
import OrgStructure from "../components/org/OrgStructure";

const TABS = [
  { key: "structure", label: "Org Structure" },
  { key: "cycles", label: "Cycles" },
  { key: "weights", label: "Scoring Weights" },
  { key: "competencies", label: "Competencies" },
];

export default function OrganizationSetup() {
  const toast = useToast();
  const [tab, setTab] = useState("structure");
  const [cycles, setCycles] = useState([]);
  const [competencies, setCompetencies] = useState([]);
  const [error, setError] = useState(null);

  async function load() {
    try {
      const [c, comp] = await Promise.all([api.get("/cycles"), api.get("/competencies")]);
      setCycles(c); setCompetencies(comp);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div>
      <Topbar subtitle="Org structure, performance cycles, scoring configuration, and the competency framework" />

      {error && <div className="error-banner">{error}</div>}

      <div className="segmented" style={{ marginBottom: 18 }}>
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "structure" && <OrgStructure />}
      {tab === "cycles" && (
        <CyclesTab cycles={cycles} onChanged={load} toast={toast} />
      )}
      {tab === "weights" && (
        <WeightsTab cycles={cycles} toast={toast} />
      )}
      {tab === "competencies" && (
        <CompetenciesTab competencies={competencies} onChanged={load} toast={toast} />
      )}
    </div>
  );
}

function CyclesTab({ cycles, onChanged, toast }) {
  const [form, setForm] = useState({ name: "", start_date: "", end_date: "", status: "planned" });

  async function add(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    await api.post("/cycles", form);
    toast.push(`Cycle "${form.name}" created`, "success");
    setForm({ name: "", start_date: "", end_date: "", status: "planned" });
    onChanged();
  }

  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-title">New Performance Cycle</div>
        <form onSubmit={add}>
          <div className="field">
            <label>Cycle name</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. H1 2027" />
          </div>
          <div className="form-grid">
            <div className="field">
              <label>Start date</label>
              <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            </div>
            <div className="field">
              <label>End date</label>
              <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Status</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="planned">Planned</option>
              <option value="active">Active</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <button className="btn btn-primary" type="submit"><Icons.plus size={15} /> Create cycle</button>
        </form>
      </div>
      <div className="card">
        <div className="card-title">Cycles</div>
        {cycles.length === 0 ? (
          <div className="empty-state">No cycles created yet.</div>
        ) : (
          cycles.map((c) => (
            <div key={c.id} className="flex-between" style={{ padding: "10px 2px", borderBottom: "1px solid #f0f2f7" }}>
              <div>
                <div className="cell-strong">{c.name}</div>
                <div className="cell-sub mono">{c.start_date} → {c.end_date || "—"}</div>
              </div>
              {c.status === "active"
                ? <span className="chip chip-success">active</span>
                : c.status === "closed"
                  ? <span className="chip chip-neutral">closed</span>
                  : <span className="chip chip-indigo">planned</span>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function WeightsTab({ cycles, toast }) {
  const [cycleId, setCycleId] = useState(null);
  const [weights, setWeights] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!cycleId) return;
    api.get(`/weights?cycle_id=${cycleId}`).then(setWeights).catch((e) => toast.push(e.message, "error"));
  }, [cycleId, toast]);

  useEffect(() => {
    if (cycles.length && cycleId == null) {
      const active = cycles.find((c) => c.status === "active");
      setCycleId((active && active.id) || cycles[0].id);
    }
  }, [cycles, cycleId]);

  const FIELDS = [
    ["kpi_weight", "KPIs"],
    ["goal_weight", "Goals"],
    ["competency_weight", "Competencies"],
    ["behavior_weight", "Behavior"],
    ["program_weight", "Programs"],
  ];

  const total = weights ? FIELDS.reduce((s, [k]) => s + (weights[k] || 0), 0) : 0;

  async function save() {
    setSaving(true);
    try {
      await api.put("/weights", { cycle_id: cycleId, ...weights });
      toast.push("Scoring weights updated — new calculations use these", "success");
    } catch (err) {
      toast.push(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-title">Overall Score = <EpistemicTag kind="calc" /></div>
        <div className="mono" style={{ fontSize: 12.5, background: "#f5f6fb", padding: "12px 14px", borderRadius: 10, lineHeight: 1.9, marginBottom: 16 }}>
          KPI Score × KPI Weight<br />
          + Goal Achievement × Goal Weight<br />
          + Competency Score × Competency Weight<br />
          + Behavior × Behavior Weight<br />
          + Programs × Program Weight
        </div>
        <div className="text-faint" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
          Weights are configurable per cycle and fall back to the organization default.
          The engine renormalizes over whichever components have data, so a partial
          assessment never distorts the others. Every calculation stays explainable.
        </div>
      </div>

      <div className="card">
        <div className="card-title">Configure Weights</div>
        <div className="field">
          <label>Cycle</label>
          <select value={cycleId || ""} onChange={(e) => setCycleId(Number(e.target.value))}>
            {cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {!weights ? (
          <div className="empty-state">Loading weights…</div>
        ) : (
          <>
            {FIELDS.map(([key, label]) => (
              <div key={key} className="flex-between" style={{ padding: "8px 0" }}>
                <label style={{ fontSize: 13, fontWeight: 500 }}>{label}</label>
                <div className="flex gap-8" style={{ alignItems: "center" }}>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    value={weights[key] ?? 0}
                    onChange={(e) => setWeights({ ...weights, [key]: Number(e.target.value) })}
                    style={{ width: 80, padding: "6px 9px", border: "1px solid var(--line-strong)", borderRadius: 8, textAlign: "right", fontFamily: "var(--font-mono)" }}
                  />
                  <span className="text-faint mono" style={{ fontSize: 12 }}>%</span>
                </div>
              </div>
            ))}
            <div className="divider" />
            <div className="flex-between">
              <span className="text-dim" style={{ fontSize: 12.5 }}>
                Total
                <span className="mono" style={{ fontWeight: 600, color: Math.abs(total - 100) < 0.001 ? "var(--green)" : "var(--crimson)" }}>
                  {" "}{total.toFixed(0)}%
                </span>
              </span>
              <button className="btn btn-primary" onClick={save} disabled={saving || Math.abs(total - 100) > 0.001}>
                {saving ? "Saving…" : "Save weights"}
              </button>
            </div>
            {Math.abs(total - 100) > 0.001 && (
              <div className="text-faint" style={{ fontSize: 11.5, marginTop: 6 }}>Weights must sum to 100% before saving.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CompetenciesTab({ competencies, onChanged, toast }) {
  const [form, setForm] = useState({ name: "", category: "technical", definition: "" });
  const [cats, setCats] = useState([]);

  useEffect(() => {
    api.get("/reference/competency-categories").then(setCats).catch(() => {});
  }, []);

  async function add(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    await api.post("/competencies", form);
    toast.push(`Competency "${form.name}" added`, "success");
    setForm({ name: "", category: (cats[0] && cats[0].code) || "technical", definition: "" });
    onChanged();
  }

  const byCat = (cat) => competencies.filter((c) => c.category === cat);
  const defaultCats = [{ code: "technical", label: "Technical" }, { code: "behavioral", label: "Behavioral" }, { code: "leadership", label: "Leadership" }];
  const frameworkCats = cats.length ? cats : defaultCats;

  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-title">Add Competency</div>
        <form onSubmit={add}>
          <div className="field">
            <label>Name</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Data Analysis" />
          </div>
          <div className="field">
            <label>Category</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {frameworkCats.map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Definition</label>
            <textarea value={form.definition} onChange={(e) => setForm({ ...form, definition: e.target.value })} />
          </div>
          <button className="btn btn-primary" type="submit"><Icons.plus size={15} /> Add competency</button>
        </form>
      </div>
      <div className="card">
        <div className="card-title">Framework</div>
        {frameworkCats.map((cat) => (
          <div key={cat.code} style={{ marginBottom: 14 }}>
            <div className="flex-between" style={{ marginBottom: 4 }}>
              <span className="cell-strong" style={{ textTransform: "capitalize" }}>{cat.label}</span>
              <span className="chip chip-neutral">{byCat(cat.code).length}</span>
            </div>
            {byCat(cat.code).map((c) => (
              <div key={c.id} className="text-dim" style={{ padding: "5px 0", fontSize: 13, borderBottom: "1px solid #f0f2f7" }}>
                {c.name}
              </div>
            ))}
          </div>
        ))}
        {competencies.length === 0 && <div className="empty-state">No competencies defined yet.</div>}
      </div>
    </div>
  );
}

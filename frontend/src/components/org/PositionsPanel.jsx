import { useState } from "react";
import { Icons } from "../icons";
import { api } from "../../api";

const EMPTY = { title: "", job_grade: "", is_head: false };

export default function PositionsPanel({ units, positions, employees, unitId, onUnitIdChange, onChanged, toast, canEdit }) {
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);

  const activeUnitId = unitId ?? units[0]?.id ?? null;
  const activeUnit = units.find((u) => u.id === activeUnitId) || null;
  const list = positions.filter((p) => p.org_unit_id === activeUnitId);
  const occupant = (posId) => employees.find((e) => e.position_id === posId);

  async function save(e) {
    e.preventDefault();
    if (!form.title.trim() || !activeUnitId) return;
    try {
      if (editingId) {
        await api.put(`/org/positions/${editingId}`, form);
        toast.push("Position updated", "success");
      } else {
        await api.post("/org/positions", { ...form, org_unit_id: activeUnitId });
        toast.push("Position added", "success");
      }
      setForm(EMPTY);
      setEditingId(null);
      onChanged();
    } catch (err) {
      toast.push(err.message, "error");
    }
  }

  function startEdit(p) {
    setEditingId(p.id);
    setForm({ title: p.title, job_grade: p.job_grade || "", is_head: Boolean(p.is_head) });
  }

  async function remove(p) {
    if (!window.confirm(`Delete position "${p.title}"?`)) return;
    try {
      await api.delete(`/org/positions/${p.id}`);
      toast.push("Position deleted", "success");
      onChanged();
    } catch (err) {
      toast.push(err.message, "error");
    }
  }

  return (
    <div>
      {onUnitIdChange && (
        <div className="field" style={{ maxWidth: 340 }}>
          <label>Org unit</label>
          <select value={activeUnitId ?? ""} onChange={(e) => onUnitIdChange(Number(e.target.value) || null)}>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
      )}
      {!activeUnit && !onUnitIdChange && (
        <div className="empty-state">Select a unit to see its positions.</div>
      )}
      {activeUnit && (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-title">
              Positions — {activeUnit.name}
              {onUnitIdChange && ""}
            </div>
            {canEdit && (
              <form onSubmit={save} style={{ marginBottom: 10 }}>
                <div className="field">
                  <label>{editingId ? "Edit position" : "Title"}</label>
                  <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Data Engineer" />
                </div>
                <div className="flex gap-8" style={{ alignItems: "center" }}>
                  <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                    <label>Job grade</label>
                    <input value={form.job_grade} onChange={(e) => setForm({ ...form, job_grade: e.target.value })} placeholder="e.g. G5" />
                  </div>
                  <label className="flex gap-8" style={{ alignItems: "center", fontSize: 13, marginTop: 18 }}>
                    <input type="checkbox" checked={form.is_head} onChange={(e) => setForm({ ...form, is_head: e.target.checked })} />
                    Head position
                  </label>
                </div>
                <div className="flex gap-8" style={{ marginTop: 10 }}>
                  <button className="btn btn-primary btn-sm" type="submit"><Icons.plus size={13} /> {editingId ? "Save" : "Add"}</button>
                  {editingId && (
                    <button type="button" className="btn btn-sm" onClick={() => { setEditingId(null); setForm(EMPTY); }}>Cancel</button>
                  )}
                </div>
              </form>
            )}
          </div>
          <div className="card">
            <div className="card-title">Position List</div>
            {list.length === 0 && <div className="empty-state">No positions in this unit.</div>}
            {list.map((p) => {
              const occ = occupant(p.id);
              return (
                <div key={p.id} className="flex-between" style={{ padding: "10px 2px", borderBottom: "1px solid #f0f2f7" }}>
                  <div>
                    <div className="cell-strong">
                      {p.title}
                      {p.is_head === 1 && <span className="chip chip-indigo" style={{ marginLeft: 8 }}>head</span>}
                      {!p.active && <span className="chip chip-neutral" style={{ marginLeft: 8 }}>inactive</span>}
                    </div>
                    <div className="cell-sub">
                      {occ ? `${occ.full_name} (${occ.position || occ.job_grade || "no role"})` : "unoccupied"}
                    </div>
                    {p.job_grade && <span className="mono text-faint" style={{ fontSize: 11.5 }}>{p.job_grade}</span>}
                  </div>
                  {canEdit && (
                    <div className="tree-actions">
                      <button title="Edit" onClick={() => startEdit(p)}><Icons.edit size={14} /></button>
                      <button title="Delete" onClick={() => remove(p)}><Icons.trash size={14} /></button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

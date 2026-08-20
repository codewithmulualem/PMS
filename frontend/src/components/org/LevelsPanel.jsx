import { useState } from "react";
import { Icons } from "../icons";
import { api } from "../../api";

export default function LevelsPanel({ unitTypes, onChanged, toast, canEdit }) {
  const [form, setForm] = useState({ name: "", level_order: unitTypes.length });
  const [editingId, setEditingId] = useState(null);

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      if (editingId) {
        await api.put(`/org/unit-types/${editingId}`, form);
        toast.push("Level type updated", "success");
      } else {
        await api.post("/org/unit-types", form);
        toast.push("Level type created", "success");
      }
      setForm({ name: "", level_order: unitTypes.length });
      setEditingId(null);
      onChanged();
    } catch (err) {
      toast.push(err.message, "error");
    }
  }

  function startEdit(ut) {
    setEditingId(ut.id);
    setForm({ name: ut.name, level_order: ut.level_order });
  }

  async function remove(ut) {
    if (!window.confirm(`Delete level type "${ut.name}"?`)) return;
    try {
      await api.delete(`/org/unit-types/${ut.id}`);
      toast.push("Level type deleted", "success");
      onChanged();
    } catch (err) {
      toast.push(err.message, "error");
    }
  }

  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-title">{editingId ? "Edit level type" : "Add level type"}</div>
        <div className="text-faint" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
          Level types define the hierarchy depth. Lower order = closer to the top (e.g. Directorate=1,
          Department=2, Section=3). Child units must be a deeper level than their parent.
        </div>
        <form onSubmit={save}>
          <div className="field">
            <label>Name</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Team" />
          </div>
          <div className="field">
            <label>Order (deeper = higher number)</label>
            <input type="number" min="0" value={form.level_order} onChange={(e) => setForm({ ...form, level_order: Number(e.target.value) })} />
          </div>
          {canEdit && (
            <div className="flex gap-8">
              <button className="btn btn-primary" type="submit"><Icons.plus size={14} /> {editingId ? "Save" : "Add"}</button>
              {editingId && <button type="button" className="btn" onClick={() => { setEditingId(null); setForm({ name: "", level_order: unitTypes.length }); }}>Cancel</button>}
            </div>
          )}
        </form>
      </div>
      <div className="card">
        <div className="card-title">Level Types</div>
        {[...unitTypes].sort((a, b) => a.level_order - b.level_order).map((ut) => (
          <div key={ut.id} className="flex-between" style={{ padding: "10px 2px", borderBottom: "1px solid #f0f2f7" }}>
            <div>
              <span className="cell-strong">{ut.name}</span>
              <span className="mono text-faint" style={{ marginLeft: 10 }}>order {ut.level_order}</span>
            </div>
            {canEdit && (
              <div className="tree-actions">
                <button title="Edit" onClick={() => startEdit(ut)}><Icons.edit size={14} /></button>
                <button title="Delete" onClick={() => remove(ut)}><Icons.trash size={14} /></button>
              </div>
            )}
          </div>
        ))}
        {unitTypes.length === 0 && <div className="empty-state">No level types yet.</div>}
      </div>
    </div>
  );
}

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
        toast.push("የደረጃ ዓይነቱ ተሻሽሏል", "success");
      } else {
        await api.post("/org/unit-types", form);
        toast.push("የደረጃ ዓይነቱ ተፈጥሯል", "success");
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
    if (!window.confirm(`የደረጃ ዓይነት “${ut.name}” ይሰረዝ?`)) return;
    try {
      await api.delete(`/org/unit-types/${ut.id}`);
      toast.push("የደረጃ ዓይነቱ ተሰርዟል", "success");
      onChanged();
    } catch (err) {
      toast.push(err.message, "error");
    }
  }

  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-title">{editingId ? "የደረጃ ዓይነት አርትዕ" : "የደረጃ ዓይነት ጨምር"}</div>
        <div className="text-faint" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
          የደረጃ ዓይነቶች የተዋረድ ጥልቀትን ይወስናሉ። ዝቅተኛ ቁጥር = ወደ ላይ ቅርብ (ለምሳሌ ዳይሬክቶሬት=1፣ መምሪያ=2፣ ክፍል=3)። የልጅ ክፍሎች ከወላጃቸው የበለጠ ጥልቀት ሊኖራቸው ይገባል።
        </div>
        <form onSubmit={save}>
          <div className="field">
            <label>ስም</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ለምሳሌ፦ ቡድን" />
          </div>
          <div className="field">
            <label>ቅደም ተከተል (ጥልቀት = ከፍተኛ ቁጥር)</label>
            <input type="number" min="0" value={form.level_order} onChange={(e) => setForm({ ...form, level_order: Number(e.target.value) })} />
          </div>
          {canEdit && (
            <div className="flex gap-8">
              <button className="btn btn-primary" type="submit"><Icons.plus size={14} /> {editingId ? "አስቀምጥ" : "ጨምር"}</button>
              {editingId && <button type="button" className="btn" onClick={() => { setEditingId(null); setForm({ name: "", level_order: unitTypes.length }); }}>ሰርዝ</button>}
            </div>
          )}
        </form>
      </div>
      <div className="card">
        <div className="card-title">የደረጃ ዓይነቶች</div>
        {[...unitTypes].sort((a, b) => a.level_order - b.level_order).map((ut) => (
          <div key={ut.id} className="flex-between" style={{ padding: "10px 2px", borderBottom: "1px solid #f0f2f7" }}>
            <div>
              <span className="cell-strong">{ut.name}</span>
              <span className="mono text-faint" style={{ marginLeft: 10 }}>ቅደም ተከተል {ut.level_order}</span>
            </div>
            {canEdit && (
              <div className="tree-actions">
                <button title="አርትዕ" onClick={() => startEdit(ut)}><Icons.edit size={14} /></button>
                <button title="ሰርዝ" onClick={() => remove(ut)}><Icons.trash size={14} /></button>
              </div>
            )}
          </div>
        ))}
        {unitTypes.length === 0 && <div className="empty-state">እስካሁን የደረጃ ዓይነት የለም።</div>}
      </div>
    </div>
  );
}

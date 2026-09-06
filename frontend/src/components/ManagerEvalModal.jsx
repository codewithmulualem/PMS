import { useState } from "react";
import { api } from "../api";
import Modal from "./Modal";
import { Icons } from "./icons";

export default function ManagerEvalModal({ member, cycleId, onClose, onSaved, toast, title, subtitle }) {
  const existing = member.manager_evaluation || null;
  const [behavior, setBehavior] = useState(existing?.behavior_score != null ? String(existing.behavior_score) : "");
  const [comments, setComments] = useState(existing?.comments ?? "");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!cycleId) { toast.push("መጀመሪያ የአፈጻጸም ዑደት ይምረጡ", "error"); return; }
    setSaving(true);
    try {
      await api.post("/evaluations", {
        employee_id: member.employee.id,
        cycle_id: cycleId,
        evaluator_type: "manager",
        behavior_score: behavior === "" ? null : Number(behavior),
        comments: comments || null,
      });
      toast.push(`የ${member.employee.full_name} የአስተዳዳሪ ግምገማ ተቀምጧል`, "success");
      onSaved();
    } catch (err) {
      toast.push(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={title || `${member.employee.full_name}ን ገምግም`}
      subtitle={subtitle || `የአስተዳዳሪ ግምገማ · ${member.employee.position}`}
      onClose={onClose}
      footer={
        <div className="flex gap-8" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-secondary" onClick={onClose}>ዝጋ</button>
          <button className="btn btn-primary" form="eval-form" type="submit" disabled={saving}>
            <Icons.send size={15} /> {saving ? "በማስቀመጥ ላይ…" : "ግምገማ አስገባ"}
          </button>
        </div>
      }
    >
      <form id="eval-form" onSubmit={submit}>
        <div className="field">
          <label>የባህሪ ነጥብ (0–100)</label>
          <input type="number" min="0" max="100" value={behavior} onChange={(e) => setBehavior(e.target.value)} placeholder="ለምሳሌ፦ 78" required />
          <span className="hint">ትብብር፣ ግንኙነት እና ኃላፊነት</span>
        </div>
        <div className="field">
          <label>አስተያየት (አስፈላጊ ማስረጃ)</label>
          <textarea value={comments} onChange={(e) => setComments(e.target.value)} placeholder="የተወሰኑ በማስረጃ የተደገፉ ምልከታዎች…" required />
        </div>
        <div className="text-faint" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
          ይህ ግምገማ ለሚሰላው ነጥብ ግብዓት ይሆናል። በኦዲት መዝገብ ይመዘገባል እና በሰው ግምገማ ይረጋገጣል።
        </div>
      </form>
    </Modal>
  );
}

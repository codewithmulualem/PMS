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
    if (!cycleId) { toast.push("Select a performance cycle first", "error"); return; }
    setSaving(true);
    try {
      await api.post("/evaluations", {
        employee_id: member.employee.id,
        cycle_id: cycleId,
        evaluator_type: "manager",
        behavior_score: behavior === "" ? null : Number(behavior),
        comments: comments || null,
      });
      toast.push(`Manager assessment saved for ${member.employee.full_name}`, "success");
      onSaved();
    } catch (err) {
      toast.push(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={title || `Assess ${member.employee.full_name}`}
      subtitle={subtitle || `Manager evaluation · ${member.employee.position}`}
      onClose={onClose}
      footer={
        <div className="flex gap-8" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="eval-form" type="submit" disabled={saving}>
            <Icons.send size={15} /> {saving ? "Saving…" : "Submit assessment"}
          </button>
        </div>
      }
    >
      <form id="eval-form" onSubmit={submit}>
        <div className="field">
          <label>Behavior score (0–100)</label>
          <input type="number" min="0" max="100" value={behavior} onChange={(e) => setBehavior(e.target.value)} placeholder="e.g. 78" required />
          <span className="hint">Collaboration, communication, ownership</span>
        </div>
        <div className="field">
          <label>Comments (required evidence)</label>
          <textarea value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Specific, evidence-backed observations…" required />
        </div>
        <div className="text-faint" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
          This assessment feeds the calculated score. It is recorded in the audit trail and remains subject to calibration and human review.
        </div>
      </form>
    </Modal>
  );
}

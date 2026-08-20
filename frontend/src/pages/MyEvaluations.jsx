import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import Topbar from "../components/Topbar";
import Modal from "../components/Modal";
import Skeleton from "../components/Skeleton";
import EvaluationForm from "../components/EvaluationForm";
import ApprovalTrail from "../components/ApprovalTrail";
import { Icons } from "../components/icons";

const STATUS_META = {
  draft: { label: "not started", cls: "chip-neutral" },
  submitted: { label: "submitted", cls: "chip-indigo" },
  in_review: { label: "in review", cls: "chip-warn" },
  rejected: { label: "returned for revision", cls: "chip-danger" },
  scored: { label: "scored", cls: "chip-success" },
};
const PERSPECTIVE_LABEL = { self: "self review", manager: "manager review", peer: "peer review" };

export default function MyEvaluations() {
  const { user } = useAuth();
  const toast = useToast();
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);

  async function load() {
    try {
      setList(await api.get("/me/evaluations"));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div>
      <Topbar subtitle="Evaluation forms assigned to you as subject or reviewer — complete, submit, and track approval" />

      {error && <div className="error-banner">{error}</div>}

      {list === null && !error ? (
        <Skeleton lines={4} height={26} />
      ) : (
        <div className="card">
          <div className="card-title">
            My Evaluations
            <span className="chip chip-neutral">{list.length} assigned</span>
          </div>
          {list.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              No evaluation forms assigned to you yet.
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Evaluation</th><th>Role</th><th>Cycle</th><th className="num">Due</th><th>Status</th><th className="num">Score</th><th className="num" /></tr>
                </thead>
                <tbody>
                  {list.map((a) => {
                    const meta = STATUS_META[a.status] || STATUS_META.draft;
                    const isReviewer = a.evaluator_id === user.employee_id && a.evaluator_type !== "self";
                    const canOpen = a.evaluator_id === user.employee_id || (a.employee_id === user.employee_id && a.status === "scored");
                    return (
                      <tr key={a.id}>
                        <td>
                          <div className="cell-strong">{a.form_name}</div>
                          <div className="cell-sub">
                            {isReviewer ? `Reviewing ${a.subject_name}` : a.subject_name !== user.employee?.full_name ? `About ${a.subject_name}` : "Your evaluation"}
                          </div>
                        </td>
                        <td>
                          <span className={`chip perspective-chip chip-${a.evaluator_type}`}>{PERSPECTIVE_LABEL[a.evaluator_type] || a.evaluator_type}</span>
                        </td>
                        <td>{a.cycle_name}</td>
                        <td className="num">
                          {a.due_date
                            ? <span className={`mono ${isOverdue(a) ? "overdue" : ""}`}>{a.due_date}</span>
                            : "—"}
                        </td>
                        <td><span className={`chip ${meta.cls}`}>{meta.label}</span></td>
                        <td className="num cell-strong">
                          {a.overall_score != null
                            ? <span className="mono" title="Combined 360 score">{a.overall_score.toFixed(1)}</span>
                            : a.score != null ? <span className="mono">{a.score.toFixed(1)}</span> : "—"}
                        </td>
                        <td className="num">
                          {canOpen ? (
                            <button className="btn btn-secondary btn-sm" onClick={() => setOpenId(a.id)}>
                              {a.status === "draft" || a.status === "rejected" ? (
                                <><Icons.edit size={13} /> Fill</>
                              ) : (
                                <><Icons.eye size={13} /> View</>
                              )}
                            </button>
                          ) : (
                            <span className="text-faint" style={{ fontSize: 11 }}>Result shown after review</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {openId && (
        <EvaluationModal
          assignmentId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => load()}
          toast={toast}
        />
      )}
    </div>
  );
}

function EvaluationModal({ assignmentId, onClose, onChanged, toast }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get(`/evaluations/${assignmentId}`).then((d) => {
      setData(d);
      const v = {};
      for (const s of d.form.sections) for (const q of s.questions) {
        if (q.answer) v[q.id] = { rating_value: q.answer.rating_value, text_value: q.answer.text_value, note: q.answer.note || "" };
      }
      setValues(v);
    }).catch((e) => toast.push(e.message, "error"));
  }, [assignmentId, toast]);

  if (!data) return <Modal title="Loading…" onClose={onClose}><div className="empty-state">Loading form…</div></Modal>;

  const editable = data.status === "draft" || data.status === "rejected";
  const isReviewer = data.evaluator?.id === user.employee_id && data.evaluator_type !== "self";
  const setAnswer = (qid, key, val) => setValues((v) => ({ ...v, [qid]: { ...v[qid], [key]: val } }));

  async function saveOrSubmit(action) {
    const answers = Object.entries(values).map(([question_id, a]) => ({
      question_id: Number(question_id),
      rating_value: a.rating_value ?? null,
      text_value: a.text_value ?? null,
      note: a.note || null,
    }));
    const fn = action === "submit" ? setSubmitting : setSaving;
    fn(true);
    try {
      const res = await api.post(`/evaluations/${assignmentId}/answers`, { action, answers });
      toast.push(
        action === "submit" ? "Submitted — sent up the approval chain" : "Draft saved",
        "success",
      );
      onChanged();
      onClose();
    } catch (err) {
      toast.push(err.message, "error");
      fn(false);
    }
  }

  return (
    <Modal
      title={data.form.name}
      subtitle={`${data.cycle?.name || ""} · ${STATUS_META[data.status]?.label || data.status}${isOverdue(data) ? " · overdue" : ""}`}
      onClose={onClose}
      wide
      footer={
        <div className="flex gap-8" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          {editable && (
            <>
              <button className="btn btn-secondary" onClick={() => saveOrSubmit("save")} disabled={saving || submitting}>
                {saving ? "Saving…" : "Save draft"}
              </button>
              <button className="btn btn-primary" onClick={() => saveOrSubmit("submit")} disabled={saving || submitting}>
                <Icons.send size={15} /> {submitting ? "Submitting…" : "Submit for approval"}
              </button>
            </>
          )}
        </div>
      }
    >
      <div className={`decision-banner ${isReviewer ? "" : "banner-muted"}`} style={{ borderLeftColor: isReviewer ? "var(--indigo)" : "var(--slate)" }}>
        {isReviewer
          ? <><Icons.shield size={15} /> You are completing the <b>{PERSPECTIVE_LABEL[data.evaluator_type]}</b> for <b>{data.employee?.full_name}</b>.</>
          : <><Icons.user size={15} /> This is your <b>{PERSPECTIVE_LABEL[data.evaluator_type] || data.evaluator_type}</b> evaluation.</>}
      </div>

      {data.status === "rejected" && (
        <div className="error-banner" style={{ marginBottom: 14 }}>
          <Icons.alert size={15} />
          This evaluation was returned for revision. See the reason below, revise, and resubmit.
        </div>
      )}
      <EvaluationForm form={data.form} values={values} onChange={editable ? setAnswer : undefined} readOnly={!editable} />

      {(data.score != null || data.overall_score != null) && (
        <div className="eval-score-card">
          <div className="eval-score-number mono">
            {(data.overall_score ?? data.score).toFixed(1)}
          </div>
          <div>
            <div className="cell-strong">
              {data.overall_score != null ? "Combined 360 score" : "Final score"}
            </div>
            <div className="cell-sub">
              {data.overall_score != null
                ? "All completed perspectives weighted by their perspective weights."
                : "Deterministically computed from the form answers, weighted by evaluation perspective."}
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <ApprovalTrail assignments={[data]} />
      </div>
    </Modal>
  );
}

function isOverdue(a) {
  if (!a.due_date || !["draft", "submitted", "in_review", "rejected"].includes(a.status)) return false;
  return new Date(a.due_date + "T23:59:59") < new Date();
}

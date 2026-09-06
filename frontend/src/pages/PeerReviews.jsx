import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import Topbar from "../components/Topbar";
import Modal from "../components/Modal";
import Skeleton from "../components/Skeleton";
import EvaluationForm from "../components/EvaluationForm";
import { Icons } from "../components/icons";

const STATUS_META = {
  draft: { label: "አልተጀመረም", cls: "chip-neutral" },
  submitted: { label: "ቀርቧል", cls: "chip-indigo" },
  in_review: { label: "በግምገማ ላይ", cls: "chip-warn" },
  rejected: { label: "ለማሻሻያ ተመልሷል", cls: "chip-danger" },
  scored: { label: "ነጥብ ተሰጥቷል", cls: "chip-success" },
};

export default function PeerReviews() {
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

  // Only peer evaluations the current user must complete as the reviewer.
  const peerReviews = (list || []).filter(
    (a) => a.evaluator_type === "peer" && a.evaluator_id === user.employee_id
  );

  return (
    <div>
      <Topbar subtitle="የሥራ ባልደረባ ግብረመልስ — ትብብርን እና የቡድን ሥራን ይገምግሙ" />

      {error && <div className="error-banner">{error}</div>}

      {list === null && !error ? (
        <Skeleton lines={4} height={26} />
      ) : (
        <div className="card">
          <div className="card-title">
            የሥራ ባልደረባ ግምገማዎች
            <span className="chip chip-neutral">{peerReviews.length} የሚቀሩ</span>
          </div>
          {peerReviews.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🤝</div>
              በአሁኑ ጊዜ ለእርስዎ የተመደበ የሥራ ባልደረባ ግምገማ የለም።
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>ባልደረባ</th><th>ቅጽ</th><th>ዑደት</th><th className="num">የመጨረሻ ቀን</th><th>ሁኔታ</th><th className="num" /></tr>
                </thead>
                <tbody>
                  {peerReviews.map((a) => {
                    const meta = STATUS_META[a.status] || STATUS_META.draft;
                    const editable = a.status === "draft" || a.status === "rejected";
                    return (
                      <tr key={a.id}>
                        <td>
                          <div className="cell-strong">{a.subject_name || "Peer"}</div>
                          <div className="cell-sub">{a.subject_position || ""}</div>
                        </td>
                        <td>{a.form_name}</td>
                        <td>{a.cycle_name}</td>
                        <td className="num">
                          {a.due_date
                            ? <span className={`mono ${isOverdue(a) ? "overdue" : ""}`}>{a.due_date}</span>
                            : "—"}
                        </td>
                        <td><span className={`chip ${meta.cls}`}>{meta.label}</span></td>
                        <td className="num">
                          <button className="btn btn-secondary btn-sm" onClick={() => setOpenId(a.id)} disabled={!editable}>
                            {editable ? <><Icons.edit size={13} /> ገምግም</> : <><Icons.eye size={13} /> ይመልከቱ</>}
                          </button>
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
        <PeerReviewModal
          assignmentId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => load()}
          toast={toast}
        />
      )}
    </div>
  );
}

function PeerReviewModal({ assignmentId, onClose, onChanged, toast }) {
  const [data, setData] = useState(null);
  const [values, setValues] = useState({});
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

  if (!data) {
    return <Modal onClose={onClose}><div className="empty-state">ቅጹ እየተጫነ ነው…</div></Modal>;
  }

  const editable = data.status === "draft" || data.status === "rejected";

  async function submit() {
    setSubmitting(true);
    try {
      const answers = [];
      for (const s of data.form.sections) for (const q of s.questions) {
        if (q.kind !== "rating" && q.kind !== "scale") continue;
        const a = values[q.id];
        if (a && a.rating_value != null) {
          answers.push({ question_id: q.id, rating_value: a.rating_value, text_value: null, note: a.note || null });
        }
      }
      await api.post(`/evaluations/${assignmentId}/answers`, { action: "submit", answers });
      toast.push(`የ${data.employee?.full_name || "ባልደረባዎ"} ግምገማ ቀርቧል`, "success");
      onChanged();
      onClose();
    } catch (err) {
      toast.push(err.message, "error");
      setSubmitting(false);
    }
  }

  return (
    <Modal onClose={onClose} wide>
      <div className="modal-head">
        <div>
          <div className="modal-title">{`${data.employee?.full_name || "ባልደረባዎ"}ን ገምግም`}</div>
          <div className="modal-sub">{data.form.name}</div>
        </div>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>
      <div className="modal-body">
        {data.status === "rejected" && (
          <div className="error-banner" style={{ marginBottom: 14 }}>
            ይህ ግምገማ ለማሻሻያ ተመልሷል። አሻሽለው እንደገና ያስገቡ።
          </div>
        )}
        <EvaluationForm
          form={data.form}
          values={values}
          onChange={editable ? (qid, key, val) => setValues((v) => ({ ...v, [qid]: { ...v[qid], [key]: val } })) : undefined}
          readOnly={!editable}
          simple
        />
        {editable && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn btn-primary" onClick={submit} disabled={submitting}>
              <Icons.send size={15} /> {submitting ? "በማስገባት ላይ…" : "አስገባ"}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function isOverdue(a) {
  if (!a.due_date || !["draft", "submitted", "in_review", "rejected"].includes(a.status)) return false;
  return new Date(a.due_date + "T23:59:59") < new Date();
}

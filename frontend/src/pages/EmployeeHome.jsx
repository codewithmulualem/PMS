import { useEffect, useState } from "react";
import { api } from "../api";
import { useCycle } from "../context/CycleContext";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import Skeleton from "../components/Skeleton";
import EvaluationForm from "../components/EvaluationForm";
import Modal from "../components/Modal";
import { Icons } from "../components/icons";
import { statusLabel } from "../i18n";

const STATUS_CHIP = {
  completed: "chip chip-success",
  in_progress: "chip chip-indigo",
  at_risk: "chip chip-danger",
  not_started: "chip chip-neutral",
  cancelled: "chip chip-neutral",
};

export default function EmployeeHome({ setPage }) {
  const { cycleId } = useCycle();
  const toast = useToast();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [evaluations, setEvaluations] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [evalModal, setEvalModal] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [dashData, evalsData, progsData] = await Promise.all([
        api.get(`/employees/${user.employee_id}/dashboard?cycle_id=${cycleId || ""}`),
        api.get("/me/evaluations"),
        api.get("/programs"),
      ]);
      setData(dashData);
      setEvaluations(evalsData);
      setPrograms(progsData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.employee_id, cycleId]);

  if (loading && !data) return <Skeleton lines={8} height={20} />;
  if (error) return <div className="error-banner">{error}</div>;
  if (!data) return null;

  const { employee, score } = data;
  const pendingEvals = evaluations.filter(
    (e) => e.status === "draft" || e.status === "rejected"
  );
  const programsList = Array.isArray(programs) ? programs : (programs?.programs || []);

  return (
    <div className="page-enter">
      {/* Hero: My Score */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">
        የእኔ የአፈጻጸም ነጥብ
        </div>
        {score && score.overall_score != null ? (
          <div className="score-hero">
            <div style={{
              fontSize: 48,
              fontWeight: 700,
              fontFamily: "var(--font-display)",
              color: score.rating?.color || "var(--indigo)",
              lineHeight: 1,
            }}>
              {score.overall_score.toFixed(0)}
            </div>
            <div className="hero-meta">
              <div className="rating-badge" style={{
                background: score.rating?.color || "var(--indigo)",
                fontSize: 14,
                padding: "4px 14px",
              }}>
                {score.rating?.label || "—"}
              </div>
              <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-dim)" }}>
                የእርስዎ የአፈጻጸም ነጥብ ለ {data.cycle_name || "ይህ ዑደት"}
              </div>
            </div>
          </div>
        ) : (
          <div className="empty-state" style={{ padding: "24px 12px" }}>
            <div className="empty-icon">◎</div>
            ግምገማዎ ከተገመገመ በኋላ ነጥቡ ይገኛል።
          </div>
        )}
      </div>

      <div className="grid grid-2">
        {/* My Tasks */}
        <div className="card">
          <div className="card-title">
            የእኔ ተግባራት
            {pendingEvals.length > 0 && (
              <span className="chip chip-indigo">{pendingEvals.length} በመጠባበቅ ላይ</span>
            )}
          </div>
          {pendingEvals.length === 0 ? (
            <div className="empty-state" style={{ padding: "24px 12px" }}>
              <div className="empty-icon">✓</div>
              የሚጠብቅ ተግባር የለም — ሁሉንም አጠናቀዋል!
            </div>
          ) : (
            <div>
              {pendingEvals.map((eval_) => {
                const icon = eval_.evaluator_type === "self" ? "⭐" :
                             eval_.evaluator_type === "peer" ? "👥" : "👔";
                const label = eval_.evaluator_type === "self" ? "ራስዎን ይገምግሙ" :
                             eval_.evaluator_type === "peer" ? `${eval_.subject_name}ን ይገምግሙ` :
                             `${eval_.subject_name}ን ይገምግሙ`;
                const isOverdue = eval_.due_date && new Date(eval_.due_date) < new Date();

                return (
                  <div
                    key={eval_.id}
                    className="goal-row"
                    style={{ cursor: "pointer" }}
                    onClick={() => setEvalModal(eval_)}
                  >
                    <div className="goal-title" style={{ fontSize: 14 }}>
                      <span>{icon}</span>
                      <span>{label}</span>
                      {isOverdue && <span className="chip chip-danger">ጊዜው አልፏል</span>}
                    </div>
                    <div className="goal-meta">
                      <span>{eval_.form_name}</span>
                      {eval_.due_date && (
                        <span style={{ color: isOverdue ? "var(--crimson)" : "var(--text-dim)" }}>
                          የመጨረሻ ቀን {new Date(eval_.due_date).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* My Programs */}
        <div className="card">
          <div className="card-title">
            የእኔ ፕሮግራሞች
            {programsList.length > 0 && (
              <span className="chip chip-neutral">{programsList.length}</span>
            )}
          </div>
          {programsList.length === 0 ? (
            <div className="empty-state" style={{ padding: "24px 12px" }}>
              <div className="empty-icon">📋</div>
              እስካሁን ፕሮግራም አልተመደበም።
            </div>
          ) : (
            <div>
              {programsList.map((prog) => (
                <div
                  key={prog.id}
                  className="goal-row"
                  style={{ cursor: "pointer" }}
                  onClick={() => setPage("programs")}
                >
                  <div className="goal-title" style={{ fontSize: 14 }}>
                    <span>{prog.name}</span>
                    <span className={STATUS_CHIP[prog.status] || "chip chip-neutral"}>
                      {statusLabel(prog.status)}
                    </span>
                  </div>
                  <div className="goal-meta">
                    <span>{prog.completed_activities ?? prog.completed_count ?? 0} ከ {prog.activity_count || 0} ተግባራት ተጠናቀዋል</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Evaluation Modal */}
      {evalModal && (
        <SimpleEvaluationModal
          assignment={evalModal}
          onClose={() => setEvalModal(null)}
          onSubmitted={() => {
            setEvalModal(null);
            toast.push("እናመሰግናለን! ማስረከቢያዎ በግምገማ ላይ ነው።", "success");
            load();
          }}
          toast={toast}
        />
      )}
    </div>
  );
}

function SimpleEvaluationModal({ assignment, onClose, onSubmitted, toast }) {
  const [data, setData] = useState(null);
  const [values, setValues] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get(`/evaluations/${assignment.id}`).then((d) => {
      setData(d);
      const v = {};
      for (const s of d.form.sections) for (const q of s.questions) {
        if (q.answer) v[q.id] = { rating_value: q.answer.rating_value, text_value: q.answer.text_value, note: q.answer.note || "" };
      }
      setValues(v);
    }).catch((e) => toast.push(e.message, "error"));
  }, [assignment.id, toast]);

  const title =
    assignment.evaluator_type === "self" ? "የራስ ግምገማዎ" :
    assignment.evaluator_type === "peer" ? `${assignment.subject_name}ን ይገምግሙ` :
    `${assignment.subject_name}ን ይገምግሙ`;

  if (!data) {
    return (
      <Modal onClose={onClose}>
        <div className="modal-head">
          <div className="modal-title">{title}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body"><div className="empty-state">ቅጹ በመጫን ላይ…</div></div>
      </Modal>
    );
  }

  const editable = data.status === "draft" || data.status === "rejected";
  const setAnswer = (qid, key, val) => setValues((v) => ({ ...v, [qid]: { ...v[qid], [key]: val } }));

  async function submit() {
    setSubmitting(true);
    try {
      const answers = [];
      for (const s of data.form.sections) for (const q of s.questions) {
        const a = values[q.id];
        if (!a) continue;
        if ((q.kind === "rating" || q.kind === "scale") && a.rating_value != null) {
          answers.push({
            question_id: q.id,
            rating_value: a.rating_value,
            text_value: null,
            note: a.note || null,
          });
        } else if (["text", "select", "multi"].includes(q.kind) && a.text_value) {
          answers.push({
            question_id: q.id,
            rating_value: null,
            text_value: a.text_value,
            note: a.note || null,
          });
        }
      }

      await api.post(`/evaluations/${assignment.id}/answers`, { action: "submit", answers });
      onSubmitted();
    } catch (err) {
      toast.push(err.message, "error");
      setSubmitting(false);
    }
  }

  return (
    <Modal onClose={onClose} wide>
      <div className="modal-head">
        <div>
          <div className="modal-title">{title}</div>
          <div className="modal-sub">{data.form.name}</div>
        </div>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>
      <div className="modal-body">
        {data.status === "rejected" && (
          <div className="error-banner" style={{ marginBottom: 14 }}>
            ይህ ግምገማ ለማሻሻያ ተመልሷል። ያሻሽሉና እንደገና ያስገቡ።
          </div>
        )}
        <EvaluationForm
          form={data.form}
          values={values}
          onChange={editable ? setAnswer : undefined}
          readOnly={!editable}
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

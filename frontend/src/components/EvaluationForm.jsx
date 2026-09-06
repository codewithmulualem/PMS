const PERSPECTIVE_LABEL = { self: "self review", manager: "manager review", peer: "peer feedback" };

const STAR_LABELS = {
  1: "ደካማ", 2: "መካከለኛ", 3: "ጥሩ", 4: "በጣም ጥሩ", 5: "ምርጥ",
};

function parseMulti(v) {
  if (!v) return [];
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr : [v];
  } catch {
    return [v];
  }
}

export default function EvaluationForm({ form, values = {}, onChange, readOnly = false, simple = false }) {
  if (!form) return null;

  const ratingLabels = {
    1: "ደካማ", 2: "መካከለኛ", 3: "ጥሩ", 4: "በጣም ጥሩ", 5: "ምርጥ",
  };

  // Simple mode: star ratings only + one comment box
  if (simple) {
    const allQuestions = form.sections.flatMap((s) => s.questions || []);
    const ratingQuestions = allQuestions.filter((q) => q.kind === "rating" || q.kind === "scale");
    const textQuestion = allQuestions.find((q) => q.kind === "text");
    const answeredCount = ratingQuestions.filter((q) => {
      const ans = values[q.id];
      return ans && ans.rating_value != null;
    }).length;

    return (
      <div className="eval-form">
        {/* Progress */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 6 }}>
            ጥያቄ {answeredCount} ከ {ratingQuestions.length}
          </div>
          <div className="meter-track">
            <div
              className="meter-fill"
              style={{
                width: `${ratingQuestions.length ? (answeredCount / ratingQuestions.length) * 100 : 0}%`,
                background: "var(--indigo)",
              }}
            />
          </div>
        </div>

        {/* Star rating questions */}
        {ratingQuestions.map((q, idx) => {
          const answer = values[q.id] || {};
          const rating = answer.rating_value;

          return (
            <div key={q.id} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
                {q.text}
                {q.required && <span style={{ color: "var(--crimson)" }}> *</span>}
              </div>
              {readOnly ? (
                <div className="q-rating-read">
                  {rating != null ? (
                    <>
                      {rating} <span className="q-rating-label">{STAR_LABELS[rating] || ""}</span>
                    </>
                  ) : (
                    <span className="q-unanswered">አልተመለሰም።</span>
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {[1, 2, 3, 4, 5].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => onChange(q.id, "rating_value", rating === v ? null : v)}
                      style={{
                        fontSize: 28,
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: v <= (rating || 0) ? "#f59e0b" : "#d1d5db",
                        transition: "color 0.15s ease",
                        padding: "0 2px",
                      }}
                      title={STAR_LABELS[v]}
                    >
                      ★
                    </button>
                  ))}
                  {rating != null && (
                    <span style={{ fontSize: 13, color: "var(--text-dim)", marginLeft: 8 }}>
                      {STAR_LABELS[rating]}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Comment box */}
        {!readOnly && textQuestion && (
          <div className="field" style={{ marginTop: 16 }}>
            <label>ተጨማሪ አስተያየት አለ?</label>
            <textarea
              value={values[textQuestion.id]?.text_value || ""}
              onChange={(e) => onChange(textQuestion.id, "text_value", e.target.value)}
              placeholder="ተጨማሪ ሐሳብ ያካፍሉ…"
              rows={3}
            />
          </div>
        )}
      </div>
    );
  }

  function Question({ q }) {
    const answer = values[q.id] || {};
    const rating = answer.rating_value;
    const text = answer.text_value || "";
    const note = answer.note || "";

    const Header = ({ tag }) => (
      <div className="q-text">
        <span className="q-idx">{tag}</span>
        {q.text}
        {q.required ? <span className="q-required">*</span> : null}
        {q.kind !== "text" && q.kind !== "select" && q.kind !== "multi" ? (
          <span className="q-max mono">/ {Math.round(q.max_score || 5)}</span>
        ) : null}
        {q.description && <div className="q-desc">{q.description}</div>}
      </div>
    );

    if (q.kind === "text") {
      return (
        <div className="q">
          <Header tag="Q" />
          {readOnly ? (
            text
              ? <div className="q-answer-text">{text}</div>
              : <div className="q-unanswered">ምላሽ አልተሰጠም።</div>
          ) : (
            <textarea
              value={text}
              onChange={(e) => onChange(q.id, "text_value", e.target.value)}
              placeholder="ምላሽዎን ይጻፉ…"
              rows={3}
            />
          )}
          <NoteBox q={q} note={note} readOnly={readOnly} onChange={onChange} />
        </div>
      );
    }

    if (q.kind === "select") {
      return (
        <div className="q">
          <Header tag="S" />
          {readOnly ? (
            text
              ? <div className="q-answer-text">{text}</div>
              : <div className="q-unanswered">አልተመለሰም።</div>
          ) : (
            <div className="option-row">
              {(q.options || []).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={`option-chip ${text === opt ? "active" : ""}`}
                  onClick={() => onChange(q.id, "text_value", text === opt ? "" : opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
          <NoteBox q={q} note={note} readOnly={readOnly} onChange={onChange} />
        </div>
      );
    }

    if (q.kind === "multi") {
      const chosen = parseMulti(text);
      const toggle = (opt) => {
        const next = chosen.includes(opt) ? chosen.filter((x) => x !== opt) : [...chosen, opt];
        onChange(q.id, "text_value", next.length ? JSON.stringify(next) : "");
      };
      return (
        <div className="q">
          <Header tag="M" />
          {readOnly ? (
            chosen.length
              ? <div className="q-answer-text">{chosen.join(" · ")}</div>
              : <div className="q-unanswered">አልተመለሰም።</div>
          ) : (
            <div className="option-row">
              {(q.options || []).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={`option-chip ${chosen.includes(opt) ? "active" : ""}`}
                  onClick={() => toggle(opt)}
                >
                  {chosen.includes(opt) ? "✓ " : ""}{opt}
                </button>
              ))}
            </div>
          )}
          <NoteBox q={q} note={note} readOnly={readOnly} onChange={onChange} />
        </div>
      );
    }

    const max = Math.round(q.max_score || 5);
    if (q.kind === "scale") {
      return (
        <div className="q">
          <Header tag="S" />
          {readOnly ? (
            rating != null
              ? <div className="q-scale-read">{rating}<span className="q-max mono"> / {max}</span></div>
              : <div className="q-unanswered">አልተመለሰም።</div>
          ) : (
            <div className="scale-row">
              <input
                type="range"
                min={1}
                max={max}
                step={1}
                value={rating ?? 1}
                onChange={(e) => onChange(q.id, "rating_value", Number(e.target.value))}
              />
              <input
                type="number"
                min={1}
                max={max}
                value={rating ?? ""}
                onChange={(e) => onChange(q.id, "rating_value", e.target.value === "" ? null : Math.max(1, Math.min(max, Number(e.target.value))))}
                className="scale-num mono"
              />
            </div>
          )}
          <NoteBox q={q} note={note} readOnly={readOnly} onChange={onChange} />
        </div>
      );
    }

    // rating: 1..max pill buttons
    return (
      <div className="q">
        <Header tag="R" />
        {readOnly ? (
          rating != null
            ? <div className="q-rating-read">{rating} <span className="q-rating-label">{ratingLabels[rating] || ""}</span></div>
            : <div className="q-unanswered">አልተመለሰም።</div>
        ) : (
          <div className="rating-row">
            {Array.from({ length: max }, (_, i) => i + 1).map((v) => (
              <button
                key={v}
                type="button"
                className={`rating-pill ${rating === v ? "active" : ""}`}
                onClick={() => onChange(q.id, "rating_value", rating === v ? null : v)}
                title={ratingLabels[v]}
              >
                {v}
              </button>
            ))}
            {rating != null && <span className="rating-label">{ratingLabels[rating]}</span>}
          </div>
        )}
        <NoteBox q={q} note={note} readOnly={readOnly} onChange={onChange} />
      </div>
    );
  }

  function NoteBox({ q, note, readOnly, onChange }) {
    if (readOnly) {
      return note ? <div className="q-note-read">ማስታወሻ — {note}</div> : null;
    }
    return (
      <textarea
        className="q-note-input"
        value={note}
        onChange={(e) => onChange(q.id, "note", e.target.value)}
        placeholder="ማስታወሻ (አማራጭ) — የዚህ ምላሽ አውድ ወይም ማስረጃ"
        rows={2}
      />
    );
  }

  return (
    <div className="eval-form">
      <div className="eval-form-head">
        <div className="eval-form-name">{form.name}</div>
        {form.description && <div className="eval-form-desc">{form.description}</div>}
      </div>
      {form.sections.map((s) => (
        <div key={s.id} className="eval-section">
          <div className="eval-section-head">
            <div className="eval-section-title">{s.title}</div>
            <div className="flex gap-8">
              {s.perspective && <span className={`chip perspective-chip chip-${s.perspective}`}>{PERSPECTIVE_LABEL[s.perspective] || s.perspective}</span>}
              {s.weight != null && <span className="chip chip-neutral mono">ክብደት {s.weight}</span>}
            </div>
          </div>
          {s.description && <div className="eval-section-desc">{s.description}</div>}
          {s.questions.map((q) => <Question key={q.id} q={q} />)}
        </div>
      ))}
    </div>
  );
}

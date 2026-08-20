const PERSPECTIVE_LABEL = { self: "self review", manager: "manager review", peer: "peer feedback" };

function parseMulti(v) {
  if (!v) return [];
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr : [v];
  } catch {
    return [v];
  }
}

export default function EvaluationForm({ form, values = {}, onChange, readOnly = false }) {
  if (!form) return null;

  const ratingLabels = {
    1: "Poor", 2: "Fair", 3: "Good", 4: "Very good", 5: "Excellent",
  };

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
              : <div className="q-unanswered">No response provided.</div>
          ) : (
            <textarea
              value={text}
              onChange={(e) => onChange(q.id, "text_value", e.target.value)}
              placeholder="Write your response…"
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
              : <div className="q-unanswered">Not answered.</div>
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
              : <div className="q-unanswered">Not answered.</div>
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
              : <div className="q-unanswered">Not answered.</div>
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
            : <div className="q-unanswered">Not answered.</div>
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
      return note ? <div className="q-note-read">Note — {note}</div> : null;
    }
    return (
      <textarea
        className="q-note-input"
        value={note}
        onChange={(e) => onChange(q.id, "note", e.target.value)}
        placeholder="Note (optional) — context or evidence for this answer"
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
              {s.weight != null && <span className="chip chip-neutral mono">weight {s.weight}</span>}
            </div>
          </div>
          {s.description && <div className="eval-section-desc">{s.description}</div>}
          {s.questions.map((q) => <Question key={q.id} q={q} />)}
        </div>
      ))}
    </div>
  );
}

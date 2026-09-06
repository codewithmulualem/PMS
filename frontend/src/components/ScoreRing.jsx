export default function ScoreRing({ score, size = 112, color = "#4c5fd5" }) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score));
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eceae2" strokeWidth={stroke} />
        {score != null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        )}
      </svg>
      <div className="score-ring-value">
        <div className="score-ring-number">{score != null ? score.toFixed(1) : "—"}</div>
        <div className="score-ring-label">ጠቅላላ</div>
      </div>
    </div>
  );
}

// Encodes the platform's core design principle: FACT, CALCULATION, AI INSIGHT
// and PREDICTION are never visually interchangeable. Every number in the app
// should be wrapped with the tag that matches how it was produced.
const LABELS = {
  fact: "እውነታ",
  calc: "ስሌት",
  insight: "የAI ግንዛቤ",
  prediction: "ትንበያ",
  risk: "ግምገማ ያስፈልጋል",
};

export default function EpistemicTag({ kind = "fact" }) {
  return <span className={`tag tag-${kind}`}>{LABELS[kind] || kind}</span>;
}

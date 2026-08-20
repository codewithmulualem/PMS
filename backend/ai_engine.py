"""
AI Performance Intelligence Layer — MVP implementation.

This MVP ships a deterministic, rule-based engine so the product works
out-of-the-box with zero external dependencies or API keys. Every generated
insight is tagged with the FACT data it's derived from (see `supporting_data`),
consistent with the platform's explainability requirement.

--- Swapping in a real LLM later ---
Replace the body of `generate_insights()` with a call to your LLM provider
(e.g. the Anthropic Messages API). Keep the function signature and the
returned insight shape (type, content, supporting_data, confidence) the same
so the rest of the app (routes, frontend) doesn't need to change. Always:
  1. Pass only the data the requesting user is authorized to see.
  2. Log the prompt/response in ai_insights.supporting_data for auditability.
  3. Never let the LLM write directly to performance_scores or evaluations —
     insights and predictions are advisory only (human_review required).
"""

from datetime import datetime
from database import get_db, rows_to_list
from scoring import calculate_employee_score
from config import get_setting


def _trend_insight(employee_id, cycle_id, current_score):
    db = get_db()
    try:
        history = rows_to_list(
            db.execute(
                "SELECT ps.overall_score, pc.name, pc.start_date FROM performance_scores ps "
                "JOIN performance_cycles pc ON pc.id = ps.cycle_id "
                "WHERE ps.employee_id = ? ORDER BY pc.start_date",
                (employee_id,),
            ).fetchall()
        )
    finally:
        db.close()

    if len(history) < 2:
        return {
            "type": "summary",
            "content": "Not enough historical cycles yet to identify a performance trend. "
                       "This insight will become more useful after the next review cycle closes.",
            "supporting_data": {"cycles_available": len(history)},
            "confidence": None,
        }

    prev, curr = history[-2]["overall_score"], history[-1]["overall_score"]
    if prev is None or curr is None:
        delta = None
    else:
        delta = round(curr - prev, 1)

    if delta is None:
        text = "The most recent cycle does not yet have a finalized score."
    elif delta > 3:
        text = f"Performance improved by {delta} points versus the previous cycle ({prev} -> {curr})."
    elif delta < -3:
        text = f"Performance declined by {abs(delta)} points versus the previous cycle ({prev} -> {curr})."
    else:
        text = f"Performance has been stable versus the previous cycle ({prev} -> {curr})."

    return {
        "type": "summary",
        "content": text,
        "supporting_data": {"history": history},
        "confidence": None,
    }


def _risk_flags(employee_id, cycle_id, breakdown):
    db = get_db()
    try:
        kpi_risk_pct = get_setting(db, "ai.kpi_risk_pct", "70", cast=float)
        at_risk_goals = rows_to_list(
            db.execute(
                "SELECT title, status, actual_value, target_value FROM goals "
                "WHERE employee_id=? AND (cycle_id=? OR cycle_id IS NULL) AND status IN ('at_risk','not_started')",
                (employee_id, cycle_id),
            ).fetchall()
        )
        low_kpis = [k for k in breakdown["explanation"]["kpis"]
                    if k.get("achievement_pct") is not None and k["achievement_pct"] < kpi_risk_pct]
    finally:
        db.close()

    flags = []
    if at_risk_goals:
        names = ", ".join(g["title"] for g in at_risk_goals[:3])
        flags.append({
            "type": "risk_flag",
            "content": f"{len(at_risk_goals)} goal(s) are flagged at-risk or not yet started, including: {names}.",
            "supporting_data": {"goals": at_risk_goals},
            "confidence": None,
        })
    if low_kpis:
        names = ", ".join(k["name"] for k in low_kpis[:3])
        flags.append({
            "type": "risk_flag",
            "content": f"{len(low_kpis)} KPI(s) are currently tracking below {kpi_risk_pct:.0f}% of target, "
                       f"including: {names}. Recommend manager review before cycle close.",
            "supporting_data": {"kpis": low_kpis},
            "confidence": None,
        })
    return flags


def _development_suggestion(employee_id, breakdown):
    comps = breakdown["explanation"]["competencies"]
    gaps = [c for c in comps if (c["target_level"] or 0) > (c["current_level"] or 0)]
    gaps.sort(key=lambda c: (c["target_level"] - c["current_level"]), reverse=True)
    if not gaps:
        return None
    top = gaps[:2]
    lines = [f"{g['competency_name']} (current {g['current_level']}/5, target {g['target_level']}/5)" for g in top]
    return {
        "type": "development",
        "content": "Largest competency gaps: " + "; ".join(lines) +
                   ". Consider targeted training and a stretch assignment covering these areas.",
        "supporting_data": {"gaps": top},
        "confidence": None,
    }


def _prediction(employee_id, cycle_id, breakdown):
    db = get_db()
    try:
        goals = rows_to_list(
            db.execute(
                "SELECT title, start_date, end_date, actual_value, target_value, baseline, status FROM goals "
                "WHERE employee_id=? AND (cycle_id=? OR cycle_id IS NULL) AND status='in_progress'",
                (employee_id, cycle_id),
            ).fetchall()
        )
    finally:
        db.close()

    if not goals:
        return None

    predictions = []
    for g in goals:
        target = g["target_value"] or 0
        baseline = g["baseline"] or 0
        actual = g["actual_value"] or 0
        span = (target - baseline) or 1
        progress_ratio = max(0.0, min(1.2, (actual - baseline) / span))
        # naive time-elapsed heuristic
        try:
            start = datetime.fromisoformat(g["start_date"])
            end = datetime.fromisoformat(g["end_date"])
            now = datetime.now()
            time_ratio = max(0.01, min(1.0, (now - start).days / max(1, (end - start).days)))
        except Exception:
            time_ratio = 0.5
        # simple heuristic: probability = how far ahead/behind progress is vs time elapsed
        raw_prob = 50 + (progress_ratio - time_ratio) * 100
        probability = round(max(2, min(97, raw_prob)))
        predictions.append({
            "goal": g["title"],
            "probability_pct": probability,
        })

    lines = "; ".join(f"{p['goal']}: {p['probability_pct']}%" for p in predictions)
    return {
        "type": "prediction",
        "content": f"Based on current progress vs. elapsed time, estimated completion probability by end date: {lines}. "
                   f"This is a statistical estimate, not a guarantee.",
        "supporting_data": {"predictions": predictions},
        "confidence": round(sum(p["probability_pct"] for p in predictions) / len(predictions)) / 100,
    }


def generate_insights(employee_id: int, cycle_id: int, persist: bool = True):
    breakdown = calculate_employee_score(employee_id, cycle_id, persist=False)
    insights = []
    insights.append(_trend_insight(employee_id, cycle_id, breakdown.get("overall_score")))
    insights.extend(_risk_flags(employee_id, cycle_id, breakdown))
    dev = _development_suggestion(employee_id, breakdown)
    if dev:
        insights.append(dev)
    pred = _prediction(employee_id, cycle_id, breakdown)
    if pred:
        insights.append(pred)

    if persist:
        db = get_db()
        try:
            import json
            for ins in insights:
                db.execute(
                    "INSERT INTO ai_insights (employee_id, cycle_id, insight_type, content, supporting_data, confidence) "
                    "VALUES (?,?,?,?,?,?)",
                    (
                        employee_id, cycle_id, ins["type"], ins["content"],
                        json.dumps(ins["supporting_data"], default=str), ins.get("confidence"),
                    ),
                )
            db.commit()
        finally:
            db.close()

    return insights


def detect_anomalies(cycle_id: int):
    """Flags patterns for HUMAN REVIEW only — never an automatic verdict.
    MVP heuristics: identical scores across an evaluator's whole team, or a
    sudden swing vs the prior cycle (threshold from settings)."""
    db = get_db()
    try:
        swing_threshold = get_setting(db, "ai.anomaly_swing_points", "25", cast=float)
        evaluators = rows_to_list(
            db.execute(
                "SELECT evaluator_id, GROUP_CONCAT(behavior_score) as scores, COUNT(*) as n "
                "FROM evaluations WHERE cycle_id=? AND status='submitted' AND evaluator_id IS NOT NULL "
                "GROUP BY evaluator_id HAVING n >= 3",
                (cycle_id,),
            ).fetchall()
        )
        flags = []
        for e in evaluators:
            scores = [float(s) for s in (e["scores"] or "").split(",") if s]
            if scores and len(set(scores)) == 1 and len(scores) >= 3:
                flags.append({
                    "type": "anomaly",
                    "content": f"Evaluator #{e['evaluator_id']} submitted identical behavior scores "
                               f"({scores[0]}) for {len(scores)} employees. Potential scoring inconsistency — recommend review.",
                    "supporting_data": {"evaluator_id": e["evaluator_id"], "scores": scores},
                })

        swings = rows_to_list(
            db.execute(
                "SELECT employee_id, overall_score, calculated_at FROM performance_scores "
                "WHERE cycle_id = ?", (cycle_id,)
            ).fetchall()
        )
        for s in swings:
            prev = db.execute(
                "SELECT overall_score FROM performance_scores WHERE employee_id=? AND cycle_id != ? "
                "ORDER BY calculated_at DESC LIMIT 1",
                (s["employee_id"], cycle_id),
            ).fetchone()
            if prev and prev["overall_score"] is not None and s["overall_score"] is not None:
                if abs(s["overall_score"] - prev["overall_score"]) >= swing_threshold:
                    flags.append({
                        "type": "anomaly",
                        "content": f"Employee #{s['employee_id']} score changed by "
                                   f"{round(s['overall_score']-prev['overall_score'],1)} points versus the prior cycle. "
                                   f"Recommend review before finalizing.",
                        "supporting_data": {"employee_id": s["employee_id"], "prev": prev["overall_score"], "current": s["overall_score"]},
                    })
        return flags
    finally:
        db.close()

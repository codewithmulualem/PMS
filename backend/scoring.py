"""
Deterministic scoring engine.

This module intentionally contains NO AI / LLM calls. Every number it produces
is a transparent calculation from stored data, per the platform's core design
principle: FACT -> CALCULATION -> AI INSIGHT -> PREDICTION must never be
blended into a single opaque number.
"""

from database import get_db, rows_to_list


def _clamp(value, lo=0, hi=100):
    return max(lo, min(hi, value))


def compute_kpi_score(kpi_row) -> float:
    """% achievement of a single KPI against its target, capped 0-120 then
    clamped to 0-100 for score-engine purposes (raw achievement % is still
    shown to users separately)."""
    target = kpi_row["target_value"]
    actual = kpi_row["actual_value"]
    if target in (None, 0) or actual is None:
        return 0.0
    direction = kpi_row["direction"]
    if direction == "lower_is_better":
        if actual <= 0:
            pct = 120.0
        else:
            pct = (target / actual) * 100.0
    elif direction == "target_is_best":
        deviation = abs(actual - target)
        pct = max(0, 100.0 - (deviation / target) * 100.0)
    else:
        pct = (actual / target) * 100.0
    return _clamp(pct, 0, 100)


def compute_goal_score(goal_row) -> float:
    target = goal_row["target_value"]
    actual = goal_row["actual_value"] or 0
    baseline = goal_row["baseline"] or 0
    if target in (None, 0):
        return 0.0
    span = target - baseline
    if span == 0:
        pct = 100.0 if actual >= target else 0.0
    else:
        pct = ((actual - baseline) / span) * 100.0
    return _clamp(pct)


def compute_activity_kpi_score(kpi_row) -> float:
    """Achievement of a single activity KPI. Supports percentage, numeric,
    milestone types and all three direction modes."""
    kpi_type = kpi_row["kpi_type"]
    target = kpi_row["target_value"]
    actual = kpi_row["actual_value"]
    if target in (None, 0) or actual is None:
        return 0.0
    if kpi_type == "milestone":
        return 100.0 if actual >= 1 else 0.0
    direction = kpi_row["direction"]
    if direction == "lower_is_better":
        pct = (target / actual) * 100.0 if actual > 0 else 120.0
    elif direction == "target_is_best":
        deviation = abs(actual - target)
        pct = max(0, 100.0 - (deviation / target) * 100.0)
    else:
        pct = (actual / target) * 100.0
    return _clamp(pct, 0, 100)


def _activity_score(db, activity_id) -> float:
    """Bottom-up recursive score for a single activity.

    Precedence:
    1. If activity has children AND KPIs, blend both (child scores weighted by
       child.weight, KPI scores weighted by kpi.weight) at 50/50 contribution.
    2. If activity has only KPIs, use KPI-weighted average.
    3. If activity has only children, use child-weighted average.
    4. Fallback: progress_pct from the activity row.

    Milestone gate: if any child is a milestone task (identified by having a
    milestone-type KPI with achievement 0), the parent is capped at 49 to
    prevent a activity from appearing complete when a gate is broken."""
    kpis = rows_to_list(
        db.execute("SELECT * FROM activity_kpis WHERE activity_id=?", (activity_id,)).fetchall()
    )
    children = rows_to_list(
        db.execute("SELECT id, weight FROM program_activities WHERE parent_id=?", (activity_id,)).fetchall()
    )

    kpi_score = None
    if kpis:
        for k in kpis:
            k["achievement_pct"] = compute_activity_kpi_score(k)
        kpi_score = weighted_average(kpis, "achievement_pct", "weight")

    child_score = None
    milestone_failed = False
    if children:
        child_scores = []
        for ch in children:
            cs = _activity_score(db, ch["id"])
            child_scores.append({"score": cs, "weight": ch["weight"] or 1})
            if cs is not None and cs < 50:
                ch_kpis = rows_to_list(
                    db.execute("SELECT * FROM activity_kpis WHERE activity_id=?", (ch["id"],)).fetchall()
                )
                for ck in ch_kpis:
                    if ck["kpi_type"] == "milestone" and (ck["actual_value"] or 0) < 1:
                        milestone_failed = True
        valid = [c for c in child_scores if c["score"] is not None]
        if valid:
            total_w = sum(c["weight"] for c in valid)
            child_score = sum(c["score"] * c["weight"] for c in valid) / total_w if total_w else None

    if kpi_score is not None and child_score is not None:
        blended = kpi_score * 0.5 + child_score * 0.5
    elif kpi_score is not None:
        blended = kpi_score
    elif child_score is not None:
        blended = child_score
    else:
        task = db.execute("SELECT progress_pct FROM program_activities WHERE id=?", (activity_id,)).fetchone()
        blended = _clamp(task["progress_pct"]) if task and task["progress_pct"] is not None else 0.0

    if milestone_failed:
        blended = min(blended, 49.0)

    return blended


def compute_program_score(db, employee_id, cycle_id) -> tuple:
    """Automated activity accomplishment for one employee in one cycle.

    Returns (score_or_None, breakdown_list) where breakdown_list is a list of
    dicts describing each activity's contribution.  Programs are weighted by
    their ``weight`` column (defaults to 1)."""
    programs = rows_to_list(
        db.execute(
            "SELECT p.id, p.name, COALESCE(p.weight, 1) as weight "
            "FROM programs p WHERE p.cycle_id=? AND p.status != 'cancelled'",
            (cycle_id,),
        ).fetchall()
    )
    if not programs:
        return None, []
    contributions = []
    for proj in programs:
        tasks = rows_to_list(
            db.execute(
                "SELECT id, title, weight FROM program_activities "
                "WHERE program_id=? AND assignee_id=? AND parent_id IS NULL",
                (proj["id"], employee_id),
            ).fetchall()
        )
        if not tasks:
            continue
        activity_scores = []
        for t in tasks:
            ts = _activity_score(db, t["id"])
            activity_scores.append({"activity": t["title"], "score": ts, "weight": t["weight"] or 1})
        valid = [t for t in activity_scores if t["score"] is not None]
        if not valid:
            continue
        total_w = sum(t["weight"] for t in valid)
        proj_score = sum(t["score"] * t["weight"] for t in valid) / total_w if total_w else None
        contributions.append({
            "activity": proj["name"],
            "program_id": proj["id"],
            "score": round(proj_score, 2) if proj_score is not None else None,
            "weight": proj["weight"],
            "activities": activity_scores,
        })
    if not contributions:
        return None, []
    valid = [c for c in contributions if c["score"] is not None]
    if not valid:
        return None, []
    total_w = sum(c["weight"] for c in valid)
    overall = sum(c["score"] * c["weight"] for c in valid) / total_w if total_w else 0
    return round(overall, 2), contributions


def weighted_average(items, score_key, weight_key):
    """items: list of dicts each with a score and a weight. Falls back to an
    unweighted average if all weights are zero (so an org that hasn't set
    weights yet still gets a sensible number)."""
    if not items:
        return None
    total_weight = sum(i[weight_key] or 0 for i in items)
    if total_weight <= 0:
        scores = [i[score_key] for i in items if i[score_key] is not None]
        return sum(scores) / len(scores) if scores else None
    return sum((i[score_key] or 0) * (i[weight_key] or 0) for i in items) / total_weight


def get_weights(db, cycle_id):
    row = db.execute(
        "SELECT * FROM score_weights WHERE cycle_id = ?", (cycle_id,)
    ).fetchone()
    if not row:
        row = db.execute(
            "SELECT * FROM score_weights WHERE cycle_id IS NULL"
        ).fetchone()
    return dict(row)


def get_rating(db, score):
    row = db.execute(
        "SELECT label, color FROM rating_bands WHERE ? >= min_score AND ? < max_score",
        (score, score),
    ).fetchone()
    return dict(row) if row else {"label": "Unrated", "color": "#888888"}


def calculate_employee_score(employee_id: int, cycle_id: int, persist: bool = True, db=None):
    """Computes the full weighted breakdown for one employee in one cycle and
    returns a component-by-component explanation (never a black box).

    Pass an already-open connection via `db` to avoid a second SQLite
    connection mid-request (e.g. when scoring a whole team in a loop)."""
    own_conn = db is None
    db = db or get_db()
    try:
        kpis = rows_to_list(
            db.execute(
                "SELECT * FROM kpis WHERE employee_id = ? AND (cycle_id = ? OR cycle_id IS NULL)",
                (employee_id, cycle_id),
            ).fetchall()
        )
        goals = rows_to_list(
            db.execute(
                "SELECT * FROM goals WHERE employee_id = ? AND (cycle_id = ? OR cycle_id IS NULL)",
                (employee_id, cycle_id),
            ).fetchall()
        )
        comps = rows_to_list(
            db.execute(
                "SELECT ec.*, c.name as competency_name FROM employee_competencies ec "
                "JOIN competencies c ON c.id = ec.competency_id WHERE ec.employee_id = ?",
                (employee_id,),
            ).fetchall()
        )
        evals = rows_to_list(
            db.execute(
                "SELECT * FROM evaluations WHERE employee_id = ? AND cycle_id = ? AND status = 'submitted'",
                (employee_id, cycle_id),
            ).fetchall()
        )

        for k in kpis:
            k["achievement_pct"] = compute_kpi_score(k)
        for gl in goals:
            gl["achievement_pct"] = compute_goal_score(gl)
        for c in comps:
            c["weight"] = 1
            c["level_pct"] = _clamp((c["current_level"] / 5.0) * 100.0)

        kpi_score = weighted_average(kpis, "achievement_pct", "weight")
        goal_score = weighted_average(goals, "achievement_pct", "weight")
        competency_score = weighted_average(comps, "level_pct", "weight")

        behavior_scores = [e["behavior_score"] for e in evals if e["behavior_score"] is not None]
        behavior_score = sum(behavior_scores) / len(behavior_scores) if behavior_scores else None
        program_score, program_breakdown = compute_program_score(db, employee_id, cycle_id)

        weights = get_weights(db, cycle_id)
        components = [
            (kpi_score, weights["kpi_weight"]),
            (goal_score, weights["goal_weight"]),
            (competency_score, weights["competency_weight"]),
            (behavior_score, weights["behavior_weight"]),
            (program_score, weights["program_weight"]),
        ]
        available = [(s, w) for s, w in components if s is not None]
        if available:
            weight_sum = sum(w for _, w in available)
            overall = sum(s * w for s, w in available) / weight_sum if weight_sum else None
        else:
            overall = None

        rating = get_rating(db, overall) if overall is not None else {"label": "Not enough data", "color": "#888888"}

        result = {
            "employee_id": employee_id,
            "cycle_id": cycle_id,
            "kpi_score": round(kpi_score, 2) if kpi_score is not None else None,
            "goal_score": round(goal_score, 2) if goal_score is not None else None,
            "competency_score": round(competency_score, 2) if competency_score is not None else None,
            "behavior_score": round(behavior_score, 2) if behavior_score is not None else None,
            "program_score": round(program_score, 2) if program_score is not None else None,
            "overall_score": round(overall, 2) if overall is not None else None,
            "rating": rating,
            "weights": weights,
            "explanation": {
                "kpis": kpis,
                "goals": goals,
                "competencies": comps,
                "programs": program_breakdown,
            },
        }

        if persist and overall is not None:
            existing = db.execute(
                "SELECT * FROM performance_scores WHERE employee_id=? AND cycle_id=?",
                (employee_id, cycle_id),
            ).fetchone()
            if existing:
                previous = existing["overall_score"]
                stored = [
                    existing["kpi_score"], existing["goal_score"], existing["competency_score"],
                    existing["behavior_score"], existing["program_score"], existing["overall_score"],
                ]
                fresh = [
                    result["kpi_score"], result["goal_score"], result["competency_score"],
                    result["behavior_score"], result["program_score"], result["overall_score"],
                ]
                changed = any(
                    (a is None) != (b is None) or (a is not None and abs(a - b) > 1e-6)
                    for a, b in zip(stored, fresh)
                )
                if changed:
                    db.execute(
                        "UPDATE performance_scores SET kpi_score=?, goal_score=?, competency_score=?, "
                        "behavior_score=?, program_score=?, overall_score=?, rating_label=?, calculated_at=datetime('now') "
                        "WHERE id=?",
                        (
                            result["kpi_score"], result["goal_score"], result["competency_score"],
                            result["behavior_score"], result["program_score"], result["overall_score"],
                            rating["label"], existing["id"],
                        ),
                    )
                    db.execute(
                        "INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value, changed_by, reason) "
                        "VALUES ('performance_score', ?, 'recalculate', ?, ?, 'system', 'score engine recalculation')",
                        (employee_id, str(previous) if previous is not None else None, str(result["overall_score"])),
                    )
            else:
                db.execute(
                    "INSERT INTO performance_scores (employee_id, cycle_id, kpi_score, goal_score, "
                    "competency_score, behavior_score, program_score, overall_score, rating_label) "
                    "VALUES (?,?,?,?,?,?,?,?,?)",
                    (
                        employee_id, cycle_id, result["kpi_score"], result["goal_score"],
                        result["competency_score"], result["behavior_score"], result["program_score"],
                        result["overall_score"], rating["label"],
                    ),
                )
                db.execute(
                    "INSERT INTO audit_log (entity_type, entity_id, action, new_value, changed_by, reason) "
                    "VALUES ('performance_score', ?, 'calculated', ?, 'system', 'score engine initial calculation')",
                    (employee_id, str(result["overall_score"])),
                )
            db.commit()

        return result
    finally:
        if own_conn:
            db.close()

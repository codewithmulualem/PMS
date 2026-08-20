"""Unit tests for the deterministic scoring engine (scoring.py)."""

import os
import sys

# Ensure backend is on path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import database
from scoring import (
    compute_kpi_score,
    compute_goal_score,
    compute_activity_kpi_score,
    _activity_score,
    weighted_average,
    _clamp,
)


# ---------------------------------------------------------------------------
# _clamp
# ---------------------------------------------------------------------------

class TestClamp:
    def test_normal(self):
        assert _clamp(50) == 50

    def test_below_min(self):
        assert _clamp(-10) == 0

    def test_above_max(self):
        assert _clamp(150) == 100

    def test_custom_range(self):
        assert _clamp(200, 0, 200) == 200


# ---------------------------------------------------------------------------
# compute_kpi_score
# ---------------------------------------------------------------------------

class TestComputeKpiScore:
    def test_higher_is_better(self):
        row = {"target_value": 100, "actual_value": 80, "direction": "higher_is_better"}
        assert compute_kpi_score(row) == 80.0

    def test_higher_is_better_over(self):
        row = {"target_value": 100, "actual_value": 120, "direction": "higher_is_better"}
        assert compute_kpi_score(row) == 100.0  # clamped

    def test_lower_is_better(self):
        row = {"target_value": 50, "actual_value": 50, "direction": "lower_is_better"}
        assert compute_kpi_score(row) == 100.0

    def test_lower_is_better_worse(self):
        row = {"target_value": 50, "actual_value": 100, "direction": "lower_is_better"}
        assert compute_kpi_score(row) == 50.0

    def test_target_is_best_exact(self):
        row = {"target_value": 100, "actual_value": 100, "direction": "target_is_best"}
        assert compute_kpi_score(row) == 100.0

    def test_target_is_best_deviation(self):
        row = {"target_value": 100, "actual_value": 80, "direction": "target_is_best"}
        assert compute_kpi_score(row) == 80.0  # 20% deviation

    def test_no_target(self):
        row = {"target_value": None, "actual_value": 50, "direction": "higher_is_better"}
        assert compute_kpi_score(row) == 0.0

    def test_no_actual(self):
        row = {"target_value": 100, "actual_value": None, "direction": "higher_is_better"}
        assert compute_kpi_score(row) == 0.0

    def test_zero_target(self):
        row = {"target_value": 0, "actual_value": 50, "direction": "higher_is_better"}
        assert compute_kpi_score(row) == 0.0


# ---------------------------------------------------------------------------
# compute_activity_kpi_score
# ---------------------------------------------------------------------------

class TestComputeActivityKpiScore:
    def test_milestone_complete(self):
        row = {"kpi_type": "milestone", "target_value": 1, "actual_value": 1, "direction": "higher_is_better"}
        assert compute_activity_kpi_score(row) == 100.0

    def test_milestone_incomplete(self):
        row = {"kpi_type": "milestone", "target_value": 1, "actual_value": 0, "direction": "higher_is_better"}
        assert compute_activity_kpi_score(row) == 0.0

    def test_percentage_higher(self):
        row = {"kpi_type": "percentage", "target_value": 200, "actual_value": 150, "direction": "higher_is_better"}
        assert compute_activity_kpi_score(row) == 75.0

    def test_numeric_lower(self):
        row = {"kpi_type": "numeric", "target_value": 10, "actual_value": 20, "direction": "lower_is_better"}
        assert compute_activity_kpi_score(row) == 50.0

    def test_target_is_best(self):
        row = {"kpi_type": "numeric", "target_value": 50, "actual_value": 50, "direction": "target_is_best"}
        assert compute_activity_kpi_score(row) == 100.0

    def test_clamped_to_100(self):
        row = {"kpi_type": "percentage", "target_value": 100, "actual_value": 500, "direction": "higher_is_better"}
        assert compute_activity_kpi_score(row) == 100.0

    def test_no_target(self):
        row = {"kpi_type": "percentage", "target_value": None, "actual_value": 100, "direction": "higher_is_better"}
        assert compute_activity_kpi_score(row) == 0.0

    def test_no_actual(self):
        row = {"kpi_type": "percentage", "target_value": 100, "actual_value": None, "direction": "higher_is_better"}
        assert compute_activity_kpi_score(row) == 0.0


# ---------------------------------------------------------------------------
# weighted_average
# ---------------------------------------------------------------------------

class TestWeightedAverage:
    def test_basic(self):
        items = [{"score": 80, "weight": 2}, {"score": 60, "weight": 1}]
        assert weighted_average(items, "score", "weight") == pytest.approx(73.33, abs=0.1)

    def test_equal_weights(self):
        items = [{"score": 80, "weight": 1}, {"score": 60, "weight": 1}]
        assert weighted_average(items, "score", "weight") == 70.0

    def test_empty(self):
        assert weighted_average([], "score", "weight") is None

    def test_zero_weights_fallback(self):
        items = [{"score": 80, "weight": 0}, {"score": 60, "weight": 0}]
        assert weighted_average(items, "score", "weight") == 70.0

    def test_none_scores(self):
        items = [{"score": None, "weight": 1}, {"score": 60, "weight": 1}]
        assert weighted_average(items, "score", "weight") == 30.0


# ---------------------------------------------------------------------------
# _activity_score (via DB)
# ---------------------------------------------------------------------------

import pytest


@pytest.fixture
def scoredb(app):
    """Yield an open DB connection with test data."""
    conn = database.get_db()
    yield conn
    conn.close()


class Testactivitiescore:
    def _make_program(self, db):
        cur = db.execute("INSERT INTO programs (name, owner_id, cycle_id) VALUES ('Test', 3, 1)")
        db.commit()
        return cur.lastrowid

    def test_fallback_to_progress(self, scoredb, app):
        pid = self._make_program(scoredb)
        cur = scoredb.execute(
            "INSERT INTO program_activities (program_id, title, progress_pct, assigned_by) VALUES (?, 'Activity', 75.0, 3)",
            (pid,),
        )
        scoredb.commit()
        assert _activity_score(scoredb, cur.lastrowid) == 75.0

    def test_kpi_only(self, scoredb, app):
        pid = self._make_program(scoredb)
        cur = scoredb.execute(
            "INSERT INTO program_activities (program_id, title, progress_pct, assigned_by) VALUES (?, 'Activity', 0, 3)",
            (pid,),
        )
        scoredb.commit()
        tid = cur.lastrowid
        scoredb.execute(
            "INSERT INTO activity_kpis (activity_id, name, kpi_type, target_value, actual_value, direction, weight) "
            "VALUES (?, 'KPI', 'percentage', 100, 80, 'higher_is_better', 1)",
            (tid,),
        )
        scoredb.commit()
        assert _activity_score(scoredb, tid) == pytest.approx(80.0, abs=0.1)

    def test_children_only(self, scoredb, app):
        pid = self._make_program(scoredb)
        parent = scoredb.execute(
            "INSERT INTO program_activities (program_id, title, progress_pct, assigned_by) VALUES (?, 'Parent', 0, 3)",
            (pid,),
        )
        scoredb.commit()
        pid_id = parent.lastrowid
        scoredb.execute(
            "INSERT INTO program_activities (program_id, parent_id, title, progress_pct, weight, assigned_by) "
            "VALUES (?, ?, 'Child1', 80, 1, 3)",
            (pid, pid_id),
        )
        scoredb.execute(
            "INSERT INTO program_activities (program_id, parent_id, title, progress_pct, weight, assigned_by) "
            "VALUES (?, ?, 'Child2', 60, 1, 3)",
            (pid, pid_id),
        )
        scoredb.commit()
        assert _activity_score(scoredb, pid_id) == pytest.approx(70.0, abs=0.1)

    def test_blended_kpi_and_children(self, scoredb, app):
        pid = self._make_program(scoredb)
        parent = scoredb.execute(
            "INSERT INTO program_activities (program_id, title, progress_pct, assigned_by) VALUES (?, 'Parent', 0, 3)",
            (pid,),
        )
        scoredb.commit()
        pid_id = parent.lastrowid
        scoredb.execute(
            "INSERT INTO activity_kpis (activity_id, name, kpi_type, target_value, actual_value, direction, weight) "
            "VALUES (?, 'KPI', 'percentage', 100, 100, 'higher_is_better', 1)",
            (pid_id,),
        )
        scoredb.execute(
            "INSERT INTO program_activities (program_id, parent_id, title, progress_pct, weight, assigned_by) "
            "VALUES (?, ?, 'Child', 50, 1, 3)",
            (pid, pid_id),
        )
        scoredb.commit()
        # KPI=100, child=50 → blended = 100*0.5 + 50*0.5 = 75
        assert _activity_score(scoredb, pid_id) == pytest.approx(75.0, abs=0.1)

    def test_milestone_gate_caps_at_49(self, scoredb, app):
        pid = self._make_program(scoredb)
        parent = scoredb.execute(
            "INSERT INTO program_activities (program_id, title, progress_pct, assigned_by) VALUES (?, 'Parent', 0, 3)",
            (pid,),
        )
        scoredb.commit()
        pid_id = parent.lastrowid
        # Child with incomplete milestone
        child = scoredb.execute(
            "INSERT INTO program_activities (program_id, parent_id, title, progress_pct, assigned_by) "
            "VALUES (?, ?, 'Gate', 0, 3)",
            (pid, pid_id),
        )
        scoredb.commit()
        child_id = child.lastrowid
        scoredb.execute(
            "INSERT INTO activity_kpis (activity_id, name, kpi_type, target_value, actual_value, direction, weight) "
            "VALUES (?, 'Milestone', 'milestone', 1, 0, 'higher_is_better', 1)",
            (child_id,),
        )
        scoredb.commit()
        score = _activity_score(scoredb, pid_id)
        # Child score is 0 (milestone incomplete), so parent gets capped at 49
        assert score <= 49.0

"""Integration tests for program/activity CRUD, hierarchy enforcement, and permissions."""

import pytest
from conftest import login, jget, jpost, jput, jdel


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def create_program(client, token, name="Test Project", **kw):
    s, d = jpost(client, "/api/programs", {"name": name, "cycle_id": 1, **kw}, token)
    assert s == 201, f"create_program failed: {s} {d}"
    return d["id"]


def create_activity(client, token, program_id, title="Test Task", **kw):
    s, d = jpost(client, f"/api/programs/{program_id}/activities", {"title": title, **kw}, token)
    assert s == 201, f"create_activity failed: {s} {d}"
    return d["id"]


# ---------------------------------------------------------------------------
# Project CRUD
# ---------------------------------------------------------------------------

class TestProjectCRUD:
    def test_create_and_get(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        s, d = jget(client, f"/api/programs/{pid}", tok)
        assert s == 200
        assert d["name"] == "Test Project"

    def test_list_scoped_to_manager(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok, "Manager Project")
        s, d = jget(client, "/api/programs", tok)
        assert s == 200
        names = [p["name"] for p in d]
        assert "Manager Project" in names

    def test_update_program(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        s, d = jput(client, f"/api/programs/{pid}", {"name": "Updated"}, tok)
        assert s == 200 and d["ok"]
        s, d = jget(client, f"/api/programs/{pid}", tok)
        assert d["name"] == "Updated"

    def test_delete_program(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        s, d = jdel(client, f"/api/programs/{pid}", tok)
        assert s == 200

    def test_ownership_required_for_delete(self, client):
        tok1 = login(client, "manager1")
        tok2 = login(client, "manager2")
        pid = create_program(client, tok1, "Owner Project")
        s, d = jdel(client, f"/api/programs/{pid}", tok2)
        assert s == 403

    def test_ownership_required_for_update(self, client):
        tok1 = login(client, "manager1")
        tok2 = login(client, "manager2")
        pid = create_program(client, tok1, "Owner Project")
        s, d = jput(client, f"/api/programs/{pid}", {"name": "Stolen"}, tok2)
        assert s == 403

    def test_admin_can_delete_any(self, client):
        tok = login(client, "manager1")
        admin = login(client, "admin1")
        pid = create_program(client, tok, "Manager Project")
        s, d = jdel(client, f"/api/programs/{pid}", admin)
        assert s == 200

    def test_employee_cannot_create(self, client):
        tok = login(client, "employee1")
        s, d = jpost(client, "/api/programs", {"name": "Nope"}, tok)
        assert s == 403

    def test_name_required(self, client):
        tok = login(client, "manager1")
        s, d = jpost(client, "/api/programs", {}, tok)
        assert s == 400


# ---------------------------------------------------------------------------
# Task CRUD + Hierarchy
# ---------------------------------------------------------------------------

class TestTaskCRUD:
    def test_create_activity(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        tid = create_activity(client, tok, pid)
        s, d = jget(client, f"/api/programs/{pid}", tok)
        assert any(t["id"] == tid for t in d["activities"])

    def test_create_subactivity(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        tid = create_activity(client, tok, pid, "Parent")
        sub = create_activity(client, tok, pid, "Child", parent_id=tid)
        s, d = jget(client, f"/api/programs/{pid}", tok)
        parent = next(t for t in d["activities"] if t["id"] == tid)
        assert any(c["id"] == sub for c in parent["children"])

    def test_update_activity(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        tid = create_activity(client, tok, pid)
        s, d = jput(client, f"/api/programs/activities/{tid}", {"title": "Updated"}, tok)
        assert s == 200

    def test_delete_activity(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        tid = create_activity(client, tok, pid)
        s, d = jdel(client, f"/api/programs/activities/{tid}", tok)
        assert s == 200

    def test_activity_on_completed_program_blocked(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok, status="completed")
        s, d = jpost(client, f"/api/programs/{pid}/activities", {"title": "Blocked"}, tok)
        assert s == 400

    def test_depth_limit(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        ids = []
        for i in range(6):
            kw = {"parent_id": ids[-1]} if ids else {}
            s, d = jpost(client, f"/api/programs/{pid}/activities", {"title": f"L{i}", **kw}, tok)
            if s == 201:
                ids.append(d["id"])
            else:
                break
        # Should have at most 5 levels (0-4) before hitting limit
        assert len(ids) == 5

    def test_cycle_detection(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        t1 = create_activity(client, tok, pid, "A")
        t2 = create_activity(client, tok, pid, "B", parent_id=t1)
        # Try to make t1 a child of t2 (cycle)
        s, d = jput(client, f"/api/programs/activities/{t1}", {"parent_id": t2}, tok)
        assert s == 400


# ---------------------------------------------------------------------------
# Assignment
# ---------------------------------------------------------------------------

class TestAssignment:
    def test_assign_to_direct_report(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        # manager1 (emp3) has emp5, emp6, emp7 as reports
        s, d = jpost(client, f"/api/programs/{pid}/activities", {"title": "Assigned", "assignee_id": 5}, tok)
        assert s == 201

    def test_assign_to_non_report_blocked(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        # emp4 (Hirut) doesn't report to manager1 (Tesfaye)
        s, d = jpost(client, f"/api/programs/{pid}/activities", {"title": "Blocked", "assignee_id": 4}, tok)
        assert s == 403

    def test_self_assignment_allowed(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        s, d = jpost(client, f"/api/programs/{pid}/activities", {"title": "Self", "assignee_id": 3}, tok)
        assert s == 201

    def test_assignable_employees(self, client):
        tok = login(client, "manager1")
        s, d = jget(client, "/api/programs/assignable", tok)
        assert s == 200
        ids = [e["id"] for e in d]
        assert 5 in ids  # emp5 reports to manager1
        assert 3 not in ids  # cannot see self

    def test_reassignment_lock(self, client):
        tok1 = login(client, "manager1")
        tok2 = login(client, "manager2")
        pid = create_program(client, tok1)
        tid = create_activity(client, tok1, pid, assignee_id=5)
        # manager2 (emp4) is not the assigner or supervisor of emp3
        s, d = jput(client, f"/api/programs/activities/{tid}", {"assignee_id": 6}, tok2)
        assert s == 403


# ---------------------------------------------------------------------------
# KPIs
# ---------------------------------------------------------------------------

class TestTaskKPIs:
    def test_create_kpi(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        tid = create_activity(client, tok, pid)
        s, d = jpost(client, f"/api/programs/activities/{tid}/kpis",
                      {"name": "KPI1", "kpi_type": "percentage", "target_value": 100}, tok)
        assert s == 201

    def test_update_kpi(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        tid = create_activity(client, tok, pid)
        s, d = jpost(client, f"/api/programs/activities/{tid}/kpis",
                      {"name": "KPI1", "kpi_type": "numeric", "target_value": 50}, tok)
        kid = d["id"]
        s, d = jput(client, f"/api/programs/kpis/{kid}", {"actual_value": 40}, tok)
        assert s == 200

    def test_delete_kpi(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        tid = create_activity(client, tok, pid)
        s, d = jpost(client, f"/api/programs/activities/{tid}/kpis",
                      {"name": "KPI1", "kpi_type": "milestone"}, tok)
        kid = d["id"]
        s, d = jdel(client, f"/api/programs/kpis/{kid}", tok)
        assert s == 200

    def test_kpi_name_required(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        tid = create_activity(client, tok, pid)
        s, d = jpost(client, f"/api/programs/activities/{tid}/kpis",
                      {"kpi_type": "percentage"}, tok)
        assert s == 400


# ---------------------------------------------------------------------------
# Progress
# ---------------------------------------------------------------------------

class TestProgress:
    def test_log_progress(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        tid = create_activity(client, tok, pid)
        s, d = jpost(client, f"/api/programs/activities/{tid}/progress",
                      {"progress_pct": 50, "notes": "Half done"}, tok)
        assert s == 201

    def test_progress_history(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        tid = create_activity(client, tok, pid)
        jpost(client, f"/api/programs/activities/{tid}/progress", {"progress_pct": 25}, tok)
        jpost(client, f"/api/programs/activities/{tid}/progress", {"progress_pct": 75}, tok)
        s, d = jget(client, f"/api/programs/activities/{tid}/progress", tok)
        assert s == 200 and len(d) == 2
        pcts = sorted([r["progress_pct"] for r in d])
        assert pcts == [25.0, 75.0]

    def test_employee_cannot_log_progress(self, client):
        tok = login(client, "employee1")
        # Create a program+activity as manager
        mtok = login(client, "manager1")
        pid = create_program(client, mtok)
        tid = create_activity(client, mtok, pid)
        s, d = jpost(client, f"/api/programs/activities/{tid}/progress",
                      {"progress_pct": 50}, tok)
        assert s == 403


# ---------------------------------------------------------------------------
# Score Preview
# ---------------------------------------------------------------------------

class TestScorePreview:
    def test_score_with_kpi(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        tid = create_activity(client, tok, pid, assignee_id=5)
        jpost(client, f"/api/programs/activities/{tid}/kpis",
              {"name": "KPI", "kpi_type": "percentage", "target_value": 100, "actual_value": 80}, tok)
        s, d = jget(client, f"/api/programs/{pid}/score", tok)
        assert s == 200
        assert d["score"] is not None
        assert d["score"] == pytest.approx(80.0, abs=0.1)

    def test_score_empty_program(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok, "Empty")
        s, d = jget(client, f"/api/programs/{pid}/score", tok)
        assert s == 200


# ---------------------------------------------------------------------------
# KPI-Driven Progress Recalculation
# ---------------------------------------------------------------------------

class TestKpiProgressRecalc:
    def test_kpi_create_with_actual_sets_progress(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        tid = create_activity(client, tok, pid)
        jpost(client, f"/api/programs/activities/{tid}/kpis",
              {"name": "KPI1", "kpi_type": "percentage", "target_value": 100, "actual_value": 60}, tok)
        s, d = jget(client, f"/api/programs/{pid}", tok)
        activity = [t for t in d["activities"] if t["id"] == tid][0]
        assert activity["progress_pct"] == pytest.approx(60.0, abs=0.1)

    def test_kpi_update_actual_recalcs_progress(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        tid = create_activity(client, tok, pid)
        s, d = jpost(client, f"/api/programs/activities/{tid}/kpis",
              {"name": "KPI1", "kpi_type": "percentage", "target_value": 100, "actual_value": 50}, tok)
        kpi_id = d["id"]
        jput(client, f"/api/programs/kpis/{kpi_id}", {"actual_value": 90}, tok)
        s, d = jget(client, f"/api/programs/{pid}", tok)
        activity = [t for t in d["activities"] if t["id"] == tid][0]
        assert activity["progress_pct"] == pytest.approx(90.0, abs=0.1)

    def test_kpi_delete_recalcs_progress(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        tid = create_activity(client, tok, pid)
        s, d = jpost(client, f"/api/programs/activities/{tid}/kpis",
              {"name": "KPI1", "kpi_type": "percentage", "target_value": 100, "actual_value": 80}, tok)
        kpi_id = d["id"]
        jdel(client, f"/api/programs/kpis/{kpi_id}", tok)
        s, d = jget(client, f"/api/programs/{pid}", tok)
        activity = [t for t in d["activities"] if t["id"] == tid][0]
        assert activity["progress_pct"] == 0.0

    def test_multiple_kpis_weighted_average(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        tid = create_activity(client, tok, pid)
        jpost(client, f"/api/programs/activities/{tid}/kpis",
              {"name": "KPI1", "kpi_type": "percentage", "target_value": 100, "actual_value": 100, "weight": 3}, tok)
        jpost(client, f"/api/programs/activities/{tid}/kpis",
              {"name": "KPI2", "kpi_type": "percentage", "target_value": 100, "actual_value": 0, "weight": 1}, tok)
        s, d = jget(client, f"/api/programs/{pid}", tok)
        activity = [t for t in d["activities"] if t["id"] == tid][0]
        assert activity["progress_pct"] == pytest.approx(75.0, abs=0.1)

    def test_progress_propagates_to_parent_activity(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        parent_tid = create_activity(client, tok, pid, title="Parent")
        child_tid = create_activity(client, tok, pid, title="Child", parent_id=parent_tid)
        jpost(client, f"/api/programs/activities/{child_tid}/kpis",
              {"name": "KPI1", "kpi_type": "percentage", "target_value": 100, "actual_value": 80}, tok)
        s, d = jget(client, f"/api/programs/{pid}", tok)
        parent = [t for t in d["activities"] if t["id"] == parent_tid][0]
        assert parent["progress_pct"] == pytest.approx(80.0, abs=0.1)

    def test_employee_can_update_actual_on_own_activity_kpi(self, client):
        mtok = login(client, "manager1")
        pid = create_program(client, mtok)
        tid = create_activity(client, mtok, pid, assignee_id=5)
        s, d = jpost(client, f"/api/programs/activities/{tid}/kpis",
              {"name": "KPI1", "kpi_type": "percentage", "target_value": 100, "actual_value": 0}, mtok)
        kpi_id = d["id"]
        etok = login(client, "employee1")
        s, d = jput(client, f"/api/programs/kpis/{kpi_id}", {"actual_value": 75}, etok)
        assert s == 200 and d["ok"]
        s, d = jget(client, f"/api/programs/{pid}", etok)
        activity = [t for t in d["activities"] if t["id"] == tid][0]
        assert activity["progress_pct"] == pytest.approx(75.0, abs=0.1)

    def test_employee_cannot_edit_kpi_name(self, client):
        mtok = login(client, "manager1")
        pid = create_program(client, mtok)
        tid = create_activity(client, mtok, pid, assignee_id=5)
        s, d = jpost(client, f"/api/programs/activities/{tid}/kpis",
              {"name": "KPI1", "kpi_type": "percentage", "target_value": 100, "actual_value": 0}, mtok)
        kpi_id = d["id"]
        etok = login(client, "employee1")
        s, d = jput(client, f"/api/programs/kpis/{kpi_id}", {"name": "Renamed"}, etok)
        assert s == 403

    def test_employee_cannot_update_other_activity_kpi(self, client):
        mtok = login(client, "manager1")
        pid = create_program(client, mtok)
        tid = create_activity(client, mtok, pid, assignee_id=6)
        s, d = jpost(client, f"/api/programs/activities/{tid}/kpis",
              {"name": "KPI1", "kpi_type": "percentage", "target_value": 100, "actual_value": 0}, mtok)
        kpi_id = d["id"]
        etok = login(client, "employee1")
        s, d = jput(client, f"/api/programs/kpis/{kpi_id}", {"actual_value": 50}, etok)
        assert s == 403

    def test_target_is_best_progress(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        tid = create_activity(client, tok, pid)
        jpost(client, f"/api/programs/activities/{tid}/kpis",
              {"name": "Temp", "kpi_type": "numeric", "target_value": 100, "actual_value": 100,
               "direction": "target_is_best"}, tok)
        s, d = jget(client, f"/api/programs/{pid}", tok)
        activity = [t for t in d["activities"] if t["id"] == tid][0]
        assert activity["progress_pct"] == pytest.approx(100.0, abs=0.1)

    def test_milestone_kpi_progress(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        tid = create_activity(client, tok, pid)
        s, d = jpost(client, f"/api/programs/activities/{tid}/kpis",
              {"name": "Gate", "kpi_type": "milestone", "target_value": 1, "actual_value": 0}, tok)
        kpi_id = d["id"]
        s, d = jget(client, f"/api/programs/{pid}", tok)
        activity = [t for t in d["activities"] if t["id"] == tid][0]
        assert activity["progress_pct"] == 0.0
        jput(client, f"/api/programs/kpis/{kpi_id}", {"actual_value": 1}, tok)
        s, d = jget(client, f"/api/programs/{pid}", tok)
        activity = [t for t in d["activities"] if t["id"] == tid][0]
        assert activity["progress_pct"] == pytest.approx(100.0, abs=0.1)

    def test_auto_status_transitions(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        tid = create_activity(client, tok, pid)
        s, d = jpost(client, f"/api/programs/activities/{tid}/kpis",
              {"name": "K1", "kpi_type": "percentage", "target_value": 100, "actual_value": 0}, tok)
        kpi_id = d["id"]
        s, d = jget(client, f"/api/programs/{pid}", tok)
        activity = [t for t in d["activities"] if t["id"] == tid][0]
        assert activity["status"] == "not_started"
        jput(client, f"/api/programs/kpis/{kpi_id}", {"actual_value": 50}, tok)
        s, d = jget(client, f"/api/programs/{pid}", tok)
        activity = [t for t in d["activities"] if t["id"] == tid][0]
        assert activity["status"] == "in_progress"
        jput(client, f"/api/programs/kpis/{kpi_id}", {"actual_value": 100}, tok)
        s, d = jget(client, f"/api/programs/{pid}", tok)
        activity = [t for t in d["activities"] if t["id"] == tid][0]
        assert activity["status"] == "completed"
        jput(client, f"/api/programs/kpis/{kpi_id}", {"actual_value": 50}, tok)
        s, d = jget(client, f"/api/programs/{pid}", tok)
        activity = [t for t in d["activities"] if t["id"] == tid][0]
        assert activity["status"] == "in_progress"
        assert activity["progress_pct"] == pytest.approx(50.0, abs=0.1)

    def test_auto_status_overdue_becomes_on_hold(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok)
        tid = create_activity(client, tok, pid, due_date="2020-01-01")
        jpost(client, f"/api/programs/activities/{tid}/kpis",
              {"name": "K1", "kpi_type": "percentage", "target_value": 100, "actual_value": 0}, tok)
        s, d = jget(client, f"/api/programs/{pid}", tok)
        activity = [t for t in d["activities"] if t["id"] == tid][0]
        assert activity["status"] == "on_hold"


# ---------------------------------------------------------------------------
# Status propagation
# ---------------------------------------------------------------------------

class TestStatusPropagation:
    def test_completing_all_activities_marks_program_completed(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok, name="P1")
        t1 = create_activity(client, tok, pid, title="A1")
        t2 = create_activity(client, tok, pid, title="A2")
        jpost(client, f"/api/programs/activities/{t1}/progress", {"progress_pct": 100}, tok)
        jpost(client, f"/api/programs/activities/{t2}/progress", {"progress_pct": 100}, tok)
        s, d = jget(client, f"/api/programs/{pid}", tok)
        assert d["status"] == "completed"

    def test_starting_one_activity_marks_program_in_progress(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok, name="P2")
        t1 = create_activity(client, tok, pid, title="A1")
        t2 = create_activity(client, tok, pid, title="A2")
        jpost(client, f"/api/programs/activities/{t1}/progress", {"progress_pct": 50}, tok)
        s, d = jget(client, f"/api/programs/{pid}", tok)
        assert d["status"] == "in_progress"

    def test_partial_completion_keeps_in_progress(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok, name="P3")
        t1 = create_activity(client, tok, pid, title="A1")
        t2 = create_activity(client, tok, pid, title="A2")
        jpost(client, f"/api/programs/activities/{t1}/progress", {"progress_pct": 100}, tok)
        jpost(client, f"/api/programs/activities/{t2}/progress", {"progress_pct": 50}, tok)
        s, d = jget(client, f"/api/programs/{pid}", tok)
        assert d["status"] == "in_progress"

    def test_cancelled_activity_ignored_in_derivation(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok, name="P4")
        t1 = create_activity(client, tok, pid, title="A1")
        t2 = create_activity(client, tok, pid, title="A2")
        jpost(client, f"/api/programs/activities/{t1}/progress", {"progress_pct": 100}, tok)
        jput(client, f"/api/programs/activities/{t2}", {"status": "cancelled"}, tok)
        s, d = jget(client, f"/api/programs/{pid}", tok)
        assert d["status"] == "completed"

    def test_manually_cancelled_program_stays_cancelled(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok, name="P5")
        t1 = create_activity(client, tok, pid, title="A1")
        jput(client, f"/api/programs/{pid}", {"status": "cancelled"}, tok)
        jpost(client, f"/api/programs/activities/{t1}/progress", {"progress_pct": 100}, tok)
        s, d = jget(client, f"/api/programs/{pid}", tok)
        assert d["status"] == "cancelled"

    def test_child_activity_status_derived_from_subchildren(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok, name="P6")
        parent = create_activity(client, tok, pid, title="Parent")
        c1 = create_activity(client, tok, pid, title="C1", parent_id=parent)
        c2 = create_activity(client, tok, pid, title="C2", parent_id=parent)
        jpost(client, f"/api/programs/activities/{c1}/progress", {"progress_pct": 100}, tok)
        jpost(client, f"/api/programs/activities/{c2}/progress", {"progress_pct": 100}, tok)
        s, d = jget(client, f"/api/programs/{pid}", tok)
        assert d["status"] == "completed"
        parent_act = [a for a in d["activities"] if a["id"] == parent][0]
        assert parent_act["status"] == "completed"

    def test_program_goes_to_planning_when_all_not_started(self, client):
        tok = login(client, "manager1")
        pid = create_program(client, tok, name="P7")
        t1 = create_activity(client, tok, pid, title="A1")
        t2 = create_activity(client, tok, pid, title="A2")
        s, d = jget(client, f"/api/programs/{pid}", tok)
        assert d["status"] == "planning"

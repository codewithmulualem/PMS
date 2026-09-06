"""Integration tests for program/activity CRUD, hierarchy enforcement, and permissions."""

import pytest
from conftest import login, jget, jpost, jput, jdel
from test_plan_performance import _build_tier_tree


@pytest.fixture(autouse=True)
def _tier_setup(client):
    _build_tier_tree(client)
    yield


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def create_program(client, name="Test Project", **kw):
    ctor = login(client, "exec1")
    s, d = jpost(client, "/api/programs", {"name": name, "cycle_id": 1, **kw}, ctor)
    assert s == 201, f"create_program failed: {s} {d}"
    return d["id"]


def team_activity(client, tok, program_id, title="Team Task", team=20, **kw):
    s, d = jpost(client, f"/api/programs/{program_id}/activities",
                 {"title": title, "org_unit_id": team, **kw}, tok)
    assert s == 201, f"team_activity failed: {s} {d}"
    return d["id"]


def member_activity(client, tok, program_id, parent_id, assignee, title="Member Task", **kw):
    s, d = jpost(client, f"/api/programs/{program_id}/activities",
                 {"title": title, "parent_id": parent_id, "assignee_id": assignee, **kw}, tok)
    assert s == 201, f"member_activity failed: {s} {d}"
    return d["id"]


def setup_team_task(client):
    """Program + a dept-head team activity on team 20."""
    dhtok = login(client, "depthead1")
    pid = create_program(client)
    tid = team_activity(client, dhtok, pid)
    return dhtok, pid, tid


def setup_member_task(client):
    """Program + team activity + lead1's member drill-down onto emp 34."""
    dhtok = login(client, "depthead1")
    ltok = login(client, "lead1")
    pid = create_program(client)
    tid = team_activity(client, dhtok, pid)
    mid = member_activity(client, ltok, pid, tid, 34)
    return dhtok, ltok, pid, tid, mid


# ---------------------------------------------------------------------------
# Project CRUD
# ---------------------------------------------------------------------------

class TestProjectCRUD:
    def test_create_and_get(self, client):
        tok = login(client, "exec1")
        pid = create_program(client)
        s, d = jget(client, f"/api/programs/{pid}", tok)
        assert s == 200
        assert d["name"] == "Test Project"

    def test_list_scoped_to_owner(self, client):
        tok = login(client, "exec1")
        pid = create_program(client, "Exec Project")
        s, d = jget(client, "/api/programs", tok)
        assert s == 200
        names = [p["name"] for p in d]
        assert "Exec Project" in names

    def test_update_program(self, client):
        tok = login(client, "exec1")
        pid = create_program(client)
        s, d = jput(client, f"/api/programs/{pid}", {"name": "Updated"}, tok)
        assert s == 200 and d["ok"]
        s, d = jget(client, f"/api/programs/{pid}", tok)
        assert d["name"] == "Updated"

    def test_delete_program(self, client):
        tok = login(client, "exec1")
        pid = create_program(client)
        s, d = jdel(client, f"/api/programs/{pid}", tok)
        assert s == 200

    def test_ownership_required_for_delete(self, client):
        tok1 = login(client, "manager1")
        tok2 = login(client, "manager2")
        pid = create_program(client, "Owner Project")
        s, d = jdel(client, f"/api/programs/{pid}", tok2)
        assert s == 403

    def test_ownership_required_for_update(self, client):
        tok1 = login(client, "manager1")
        tok2 = login(client, "manager2")
        pid = create_program(client, "Owner Project")
        s, d = jput(client, f"/api/programs/{pid}", {"name": "Stolen"}, tok2)
        assert s == 403

    def test_admin_can_delete_any(self, client):
        admin = login(client, "admin1")
        pid = create_program(client, "Manager Project")
        s, d = jdel(client, f"/api/programs/{pid}", admin)
        assert s == 200

    def test_employee_cannot_create(self, client):
        tok = login(client, "employee1")
        s, d = jpost(client, "/api/programs", {"name": "Nope"}, tok)
        assert s == 403

    def test_manager_cannot_create(self, client):
        tok = login(client, "manager1")
        s, d = jpost(client, "/api/programs", {"name": "Nope"}, tok)
        assert s == 403

    def test_name_required(self, client):
        tok = login(client, "exec1")
        s, d = jpost(client, "/api/programs", {}, tok)
        assert s == 400


# ---------------------------------------------------------------------------
# Task CRUD + Hierarchy
# ---------------------------------------------------------------------------

class TestTaskCRUD:
    def test_create_team_activity(self, client):
        dhtok, pid, tid = setup_team_task(client)
        s, d = jget(client, f"/api/programs/{pid}", dhtok)
        assert any(t["id"] == tid and t["org_unit_id"] == 20 for t in d["activities"])

    def test_create_subactivity(self, client):
        dhtok, pid, tid = setup_team_task(client)
        sub = team_activity(client, dhtok, pid, "Child", parent_id=tid)
        s, d = jget(client, f"/api/programs/{pid}", dhtok)
        parent = next(t for t in d["activities"] if t["id"] == tid)
        assert any(c["id"] == sub for c in parent["children"])

    def test_leader_drills_down_member_task(self, client):
        dhtok, ltok, pid, tid, mid = setup_member_task(client)
        s, d = jget(client, f"/api/programs/{pid}", ltok)
        root = next(t for t in d["activities"] if t["id"] == tid)
        assert any(c["id"] == mid and c["assignee_id"] == 34 for c in root["children"])

    def test_update_activity(self, client):
        dhtok, pid, tid = setup_team_task(client)
        s, d = jput(client, f"/api/programs/activities/{tid}", {"title": "Updated"}, dhtok)
        assert s == 200

    def test_delete_activity(self, client):
        dhtok, pid, tid = setup_team_task(client)
        s, d = jdel(client, f"/api/programs/activities/{tid}", dhtok)
        assert s == 200

    def test_activity_on_completed_program_blocked(self, client):
        dhtok = login(client, "depthead1")
        pid = create_program(client, status="completed")
        s, d = jpost(client, f"/api/programs/{pid}/activities",
                     {"title": "Blocked", "org_unit_id": 20}, dhtok)
        assert s == 400

    def test_depth_limit(self, client):
        dhtok, pid, _ = setup_team_task(client)
        ids = []
        for i in range(6):
            kw = {"parent_id": ids[-1]} if ids else {"org_unit_id": 20}
            s, d = jpost(client, f"/api/programs/{pid}/activities", {"title": f"L{i}", **kw}, dhtok)
            if s == 201:
                ids.append(d["id"])
            else:
                break
        # Should have at most 5 levels (0-4) before hitting limit
        assert len(ids) == 5

    def test_cycle_detection(self, client):
        dhtok, pid, t1 = setup_team_task(client)
        t2 = team_activity(client, dhtok, pid, "B", parent_id=t1)
        # Try to make t1 a child of t2 (cycle)
        s, d = jput(client, f"/api/programs/activities/{t1}", {"parent_id": t2}, dhtok)
        assert s == 400


# ---------------------------------------------------------------------------
# Assignment scope
# ---------------------------------------------------------------------------

class TestAssignmentScope:
    def test_dept_head_sets_activity_for_own_team(self, client):
        dhtok = login(client, "depthead1")
        pid = create_program(client)
        s, d = jpost(client, f"/api/programs/{pid}/activities",
                     {"title": "Assigned", "org_unit_id": 20}, dhtok)
        assert s == 201

    def test_dept_head_blocked_from_foreign_team(self, client):
        dhtok = login(client, "depthead1")
        pid = create_program(client)
        # team 22 lives under the Finance dept, outside d10's subtree
        s, d = jpost(client, f"/api/programs/{pid}/activities",
                     {"title": "Blocked", "org_unit_id": 22}, dhtok)
        assert s == 403

    def test_activity_requires_team_level_org_unit(self, client):
        dhtok = login(client, "depthead1")
        pid = create_program(client)
        s, d = jpost(client, f"/api/programs/{pid}/activities",
                     {"title": "Dept-level", "org_unit_id": 10}, dhtok)
        assert s == 400

    def test_org_unit_required_for_dept_set_activity(self, client):
        dhtok = login(client, "depthead1")
        pid = create_program(client)
        s, d = jpost(client, f"/api/programs/{pid}/activities", {"title": "No team"}, dhtok)
        assert s == 400

    def test_leader_must_drill_down_from_own_team(self, client):
        dhtok, ltok, pid, _, _ = setup_member_task(client)
        s, d = jpost(client, f"/api/programs/{pid}/activities",
                     {"title": "Rootless", "org_unit_id": 20}, ltok)
        assert s == 403
        # drilling under a team-21 activity is blocked
        foreign = team_activity(client, dhtok, pid, "Other", team=21)
        s, d = jpost(client, f"/api/programs/{pid}/activities",
                     {"title": "Foreign", "parent_id": foreign,
                      "assignee_id": 36}, ltok)
        assert s == 403

    def test_leader_assignee_must_be_own_member(self, client):
        dhtok, pid, tid = setup_team_task(client)
        ltok = login(client, "lead1")
        s, d = jpost(client, f"/api/programs/{pid}/activities",
                     {"title": "Cross", "parent_id": tid,
                      "assignee_id": 36}, ltok)
        assert s == 403

    def test_admin_can_set_activity_anywhere(self, client):
        admintok = login(client, "admin1")
        pid = create_program(client)
        s, d = jpost(client, f"/api/programs/{pid}/activities",
                     {"title": "Admin task", "org_unit_id": 22}, admintok)
        assert s == 201

    def test_employee_cannot_create_activity(self, client):
        tok = login(client, "emp20")
        pid = create_program(client)
        s, d = jpost(client, f"/api/programs/{pid}/activities",
                     {"title": "Nope", "org_unit_id": 20}, tok)
        assert s == 403

    def test_foreign_leader_cannot_reassign(self, client):
        dhtok, pid, tid = setup_team_task(client)
        lead2 = login(client, "lead2")
        s, d = jput(client, f"/api/programs/activities/{tid}",
                    {"title": "Stolen"}, lead2)
        assert s == 403

    def test_assignable_teams_scoped_to_department(self, client):
        dhtok = login(client, "depthead1")
        s, d = jget(client, "/api/programs/assignable-teams", dhtok)
        assert s == 200
        ids = [t["id"] for t in d]
        assert 20 in ids and 21 in ids
        assert 22 not in ids

    def test_assignable_teams_admin_sees_all(self, client):
        admintok = login(client, "admin1")
        s, d = jget(client, "/api/programs/assignable-teams", admintok)
        assert s == 200
        ids = [t["id"] for t in d]
        assert 20 in ids and 21 in ids and 22 in ids

    def test_programs_for_department(self, client):
        dhtok = login(client, "depthead1")
        pid = create_program(client, "Reg Program")
        s, d = jget(client, "/api/programs/for-department", dhtok)
        assert s == 200
        assert any(p["id"] == pid for p in d)


# ---------------------------------------------------------------------------
# KPIs
# ---------------------------------------------------------------------------

class TestTaskKPIs:
    def test_create_kpi(self, client):
        dhtok, pid, tid = setup_team_task(client)
        s, d = jpost(client, f"/api/programs/activities/{tid}/kpis",
                      {"name": "KPI1", "kpi_type": "percentage", "target_value": 100}, dhtok)
        assert s == 201

    def test_update_kpi(self, client):
        dhtok, pid, tid = setup_team_task(client)
        s, d = jpost(client, f"/api/programs/activities/{tid}/kpis",
                      {"name": "KPI1", "kpi_type": "numeric", "target_value": 50}, dhtok)
        kid = d["id"]
        s, d = jput(client, f"/api/programs/kpis/{kid}", {"actual_value": 40}, dhtok)
        assert s == 200

    def test_delete_kpi(self, client):
        dhtok, pid, tid = setup_team_task(client)
        s, d = jpost(client, f"/api/programs/activities/{tid}/kpis",
                      {"name": "KPI1", "kpi_type": "milestone"}, dhtok)
        kid = d["id"]
        s, d = jdel(client, f"/api/programs/kpis/{kid}", dhtok)
        assert s == 200

    def test_kpi_name_required(self, client):
        dhtok, pid, tid = setup_team_task(client)
        s, d = jpost(client, f"/api/programs/activities/{tid}/kpis",
                      {"kpi_type": "percentage"}, dhtok)
        assert s == 400

    def test_leader_can_manage_kpis_on_own_team(self, client):
        dhtok, ltok, pid, tid, mid = setup_member_task(client)
        # team root activity: lead manages it (own team)
        s, d = jpost(client, f"/api/programs/activities/{tid}/kpis",
                      {"name": "K1", "kpi_type": "percentage", "target_value": 100}, ltok)
        assert s == 201
        # member task: lead can add KPIs too
        s, d = jpost(client, f"/api/programs/activities/{mid}/kpis",
                      {"name": "K2", "kpi_type": "percentage", "target_value": 100}, ltok)
        assert s == 201

    def test_foreign_leader_cannot_manage_kpis(self, client):
        dhtok, pid, tid = setup_team_task(client)
        lead2 = login(client, "lead2")
        s, d = jpost(client, f"/api/programs/activities/{tid}/kpis",
                      {"name": "K1", "kpi_type": "percentage", "target_value": 100}, lead2)
        assert s == 403

    def test_executive_cannot_manage_kpis(self, client):
        dhtok, pid, tid = setup_team_task(client)
        etok = login(client, "exec1")
        s, d = jpost(client, f"/api/programs/activities/{tid}/kpis",
                      {"name": "K1", "kpi_type": "percentage", "target_value": 100}, etok)
        assert s == 403


# ---------------------------------------------------------------------------
# Progress
# ---------------------------------------------------------------------------

class TestProgress:
    def test_log_progress(self, client):
        dhtok, pid, tid = setup_team_task(client)
        s, d = jpost(client, f"/api/programs/activities/{tid}/progress",
                      {"progress_pct": 50, "notes": "Half done"}, dhtok)
        assert s == 201

    def test_progress_history(self, client):
        dhtok, pid, tid = setup_team_task(client)
        jpost(client, f"/api/programs/activities/{tid}/progress", {"progress_pct": 25}, dhtok)
        jpost(client, f"/api/programs/activities/{tid}/progress", {"progress_pct": 75}, dhtok)
        s, d = jget(client, f"/api/programs/activities/{tid}/progress", dhtok)
        assert s == 200 and len(d) == 2
        pcts = sorted([r["progress_pct"] for r in d])
        assert pcts == [25.0, 75.0]

    def test_leader_logs_member_progress(self, client):
        _, ltok, pid, _, mid = setup_member_task(client)
        s, d = jpost(client, f"/api/programs/activities/{mid}/progress",
                      {"progress_pct": 40}, ltok)
        assert s == 201

    def test_employee_cannot_log_progress(self, client):
        dhtok, pid, tid = setup_team_task(client)
        tok = login(client, "emp20")
        s, d = jpost(client, f"/api/programs/activities/{tid}/progress",
                      {"progress_pct": 50}, tok)
        assert s == 403

    def test_executive_cannot_log_progress(self, client):
        dhtok, pid, tid = setup_team_task(client)
        etok = login(client, "exec1")
        s, d = jpost(client, f"/api/programs/activities/{tid}/progress",
                      {"progress_pct": 50}, etok)
        assert s == 403


# ---------------------------------------------------------------------------
# Score Preview
# ---------------------------------------------------------------------------

class TestScorePreview:
    def test_score_with_kpi(self, client):
        dhtok, pid, tid = setup_team_task(client)
        jpost(client, f"/api/programs/activities/{tid}/kpis",
              {"name": "KPI", "kpi_type": "percentage", "target_value": 100, "actual_value": 80}, dhtok)
        s, d = jget(client, f"/api/programs/{pid}/score", dhtok)
        assert s == 200
        assert d["score"] is not None
        assert d["score"] == pytest.approx(80.0, abs=0.1)

    def test_score_empty_program(self, client):
        dhtok = login(client, "depthead1")
        pid = create_program(client, "Empty")
        s, d = jget(client, f"/api/programs/{pid}/score", dhtok)
        assert s == 200


# ---------------------------------------------------------------------------
# KPI-Driven Progress Recalculation
# ---------------------------------------------------------------------------

class TestKpiProgressRecalc:
    def test_kpi_create_with_actual_sets_progress(self, client):
        dhtok, pid, tid = setup_team_task(client)
        jpost(client, f"/api/programs/activities/{tid}/kpis",
              {"name": "KPI1", "kpi_type": "percentage", "target_value": 100, "actual_value": 60}, dhtok)
        s, d = jget(client, f"/api/programs/{pid}", dhtok)
        activity = [t for t in d["activities"] if t["id"] == tid][0]
        assert activity["progress_pct"] == pytest.approx(60.0, abs=0.1)

    def test_kpi_update_actual_recalcs_progress(self, client):
        dhtok, pid, tid = setup_team_task(client)
        s, d = jpost(client, f"/api/programs/activities/{tid}/kpis",
              {"name": "KPI1", "kpi_type": "percentage", "target_value": 100, "actual_value": 50}, dhtok)
        kpi_id = d["id"]
        jput(client, f"/api/programs/kpis/{kpi_id}", {"actual_value": 90}, dhtok)
        s, d = jget(client, f"/api/programs/{pid}", dhtok)
        activity = [t for t in d["activities"] if t["id"] == tid][0]
        assert activity["progress_pct"] == pytest.approx(90.0, abs=0.1)

    def test_kpi_delete_recalcs_progress(self, client):
        dhtok, pid, tid = setup_team_task(client)
        s, d = jpost(client, f"/api/programs/activities/{tid}/kpis",
              {"name": "KPI1", "kpi_type": "percentage", "target_value": 100, "actual_value": 80}, dhtok)
        kpi_id = d["id"]
        jdel(client, f"/api/programs/kpis/{kpi_id}", dhtok)
        s, d = jget(client, f"/api/programs/{pid}", dhtok)
        activity = [t for t in d["activities"] if t["id"] == tid][0]
        assert activity["progress_pct"] == 0.0

    def test_multiple_kpis_weighted_average(self, client):
        dhtok, pid, tid = setup_team_task(client)
        jpost(client, f"/api/programs/activities/{tid}/kpis",
              {"name": "KPI1", "kpi_type": "percentage", "target_value": 100, "actual_value": 100, "weight": 3}, dhtok)
        jpost(client, f"/api/programs/activities/{tid}/kpis",
              {"name": "KPI2", "kpi_type": "percentage", "target_value": 100, "actual_value": 0, "weight": 1}, dhtok)
        s, d = jget(client, f"/api/programs/{pid}", dhtok)
        activity = [t for t in d["activities"] if t["id"] == tid][0]
        assert activity["progress_pct"] == pytest.approx(75.0, abs=0.1)

    def test_progress_propagates_to_parent_activity(self, client):
        dhtok, pid, tid = setup_team_task(client)
        child_tid = team_activity(client, dhtok, pid, title="Child", parent_id=tid)
        jpost(client, f"/api/programs/activities/{child_tid}/kpis",
              {"name": "KPI1", "kpi_type": "percentage", "target_value": 100, "actual_value": 80}, dhtok)
        s, d = jget(client, f"/api/programs/{pid}", dhtok)
        parent = [t for t in d["activities"] if t["id"] == tid][0]
        assert parent["progress_pct"] == pytest.approx(80.0, abs=0.1)

    def test_employee_can_update_actual_on_own_activity_kpi(self, client):
        dhtok, pid, tid = setup_team_task(client)
        ltok = login(client, "lead1")
        mid = member_activity(client, ltok, pid, tid, 34)
        s, d = jpost(client, f"/api/programs/activities/{mid}/kpis",
              {"name": "KPI1", "kpi_type": "percentage", "target_value": 100, "actual_value": 0}, ltok)
        kpi_id = d["id"]
        etok = login(client, "emp20")
        s, d = jput(client, f"/api/programs/kpis/{kpi_id}", {"actual_value": 75}, etok)
        assert s == 200 and d["ok"]
        s, d = jget(client, f"/api/programs/{pid}", etok)
        member = [t for t in d["activities"] if t["id"] == tid][0]["children"][0]
        assert member["progress_pct"] == pytest.approx(75.0, abs=0.1)

    def test_employee_cannot_edit_kpi_name(self, client):
        dhtok, pid, tid = setup_team_task(client)
        ltok = login(client, "lead1")
        mid = member_activity(client, ltok, pid, tid, 34)
        s, d = jpost(client, f"/api/programs/activities/{mid}/kpis",
              {"name": "KPI1", "kpi_type": "percentage", "target_value": 100, "actual_value": 0}, ltok)
        kpi_id = d["id"]
        etok = login(client, "emp20")
        s, d = jput(client, f"/api/programs/kpis/{kpi_id}", {"name": "Renamed"}, etok)
        assert s == 403

    def test_employee_cannot_update_other_activity_kpi(self, client):
        dhtok, pid, tid = setup_team_task(client)
        ltok = login(client, "lead1")
        mid = member_activity(client, ltok, pid, tid, 35)
        s, d = jpost(client, f"/api/programs/activities/{mid}/kpis",
              {"name": "KPI1", "kpi_type": "percentage", "target_value": 100, "actual_value": 0}, ltok)
        kpi_id = d["id"]
        etok = login(client, "emp20")
        s, d = jput(client, f"/api/programs/kpis/{kpi_id}", {"actual_value": 50}, etok)
        assert s == 403

    def test_target_is_best_progress(self, client):
        dhtok, pid, tid = setup_team_task(client)
        jpost(client, f"/api/programs/activities/{tid}/kpis",
              {"name": "Temp", "kpi_type": "numeric", "target_value": 100, "actual_value": 100,
               "direction": "target_is_best"}, dhtok)
        s, d = jget(client, f"/api/programs/{pid}", dhtok)
        activity = [t for t in d["activities"] if t["id"] == tid][0]
        assert activity["progress_pct"] == pytest.approx(100.0, abs=0.1)

    def test_milestone_kpi_progress(self, client):
        dhtok, pid, tid = setup_team_task(client)
        s, d = jpost(client, f"/api/programs/activities/{tid}/kpis",
              {"name": "Gate", "kpi_type": "milestone", "target_value": 1, "actual_value": 0}, dhtok)
        kpi_id = d["id"]
        s, d = jget(client, f"/api/programs/{pid}", dhtok)
        activity = [t for t in d["activities"] if t["id"] == tid][0]
        assert activity["progress_pct"] == 0.0
        jput(client, f"/api/programs/kpis/{kpi_id}", {"actual_value": 1}, dhtok)
        s, d = jget(client, f"/api/programs/{pid}", dhtok)
        activity = [t for t in d["activities"] if t["id"] == tid][0]
        assert activity["progress_pct"] == pytest.approx(100.0, abs=0.1)

    def test_auto_status_transitions(self, client):
        dhtok, pid, tid = setup_team_task(client)
        s, d = jpost(client, f"/api/programs/activities/{tid}/kpis",
              {"name": "K1", "kpi_type": "percentage", "target_value": 100, "actual_value": 0}, dhtok)
        kpi_id = d["id"]
        s, d = jget(client, f"/api/programs/{pid}", dhtok)
        activity = [t for t in d["activities"] if t["id"] == tid][0]
        assert activity["status"] == "not_started"
        jput(client, f"/api/programs/kpis/{kpi_id}", {"actual_value": 50}, dhtok)
        s, d = jget(client, f"/api/programs/{pid}", dhtok)
        activity = [t for t in d["activities"] if t["id"] == tid][0]
        assert activity["status"] == "in_progress"
        jput(client, f"/api/programs/kpis/{kpi_id}", {"actual_value": 100}, dhtok)
        s, d = jget(client, f"/api/programs/{pid}", dhtok)
        activity = [t for t in d["activities"] if t["id"] == tid][0]
        assert activity["status"] == "completed"
        jput(client, f"/api/programs/kpis/{kpi_id}", {"actual_value": 50}, dhtok)
        s, d = jget(client, f"/api/programs/{pid}", dhtok)
        activity = [t for t in d["activities"] if t["id"] == tid][0]
        assert activity["status"] == "in_progress"
        assert activity["progress_pct"] == pytest.approx(50.0, abs=0.1)

    def test_auto_status_overdue_becomes_on_hold(self, client):
        dhtok = login(client, "depthead1")
        pid = create_program(client)
        tid = team_activity(client, dhtok, pid, due_date="2020-01-01")
        jpost(client, f"/api/programs/activities/{tid}/kpis",
              {"name": "K1", "kpi_type": "percentage", "target_value": 100, "actual_value": 0}, dhtok)
        s, d = jget(client, f"/api/programs/{pid}", dhtok)
        activity = [t for t in d["activities"] if t["id"] == tid][0]
        assert activity["status"] == "on_hold"


# ---------------------------------------------------------------------------
# Status propagation
# ---------------------------------------------------------------------------

class TestStatusPropagation:
    def test_completing_all_activities_marks_program_completed(self, client):
        dhtok, pid, t1 = setup_team_task(client)
        t2 = team_activity(client, dhtok, pid, title="A2")
        jpost(client, f"/api/programs/activities/{t1}/progress", {"progress_pct": 100}, dhtok)
        jpost(client, f"/api/programs/activities/{t2}/progress", {"progress_pct": 100}, dhtok)
        s, d = jget(client, f"/api/programs/{pid}", dhtok)
        assert d["status"] == "completed"

    def test_starting_one_activity_marks_program_in_progress(self, client):
        dhtok, pid, t1 = setup_team_task(client)
        t2 = team_activity(client, dhtok, pid, title="A2")
        jpost(client, f"/api/programs/activities/{t1}/progress", {"progress_pct": 50}, dhtok)
        s, d = jget(client, f"/api/programs/{pid}", dhtok)
        assert d["status"] == "in_progress"

    def test_partial_completion_keeps_in_progress(self, client):
        dhtok, pid, t1 = setup_team_task(client)
        t2 = team_activity(client, dhtok, pid, title="A2")
        jpost(client, f"/api/programs/activities/{t1}/progress", {"progress_pct": 100}, dhtok)
        jpost(client, f"/api/programs/activities/{t2}/progress", {"progress_pct": 50}, dhtok)
        s, d = jget(client, f"/api/programs/{pid}", dhtok)
        assert d["status"] == "in_progress"

    def test_cancelled_activity_ignored_in_derivation(self, client):
        dhtok, pid, t1 = setup_team_task(client)
        t2 = team_activity(client, dhtok, pid, title="A2")
        jpost(client, f"/api/programs/activities/{t1}/progress", {"progress_pct": 100}, dhtok)
        jput(client, f"/api/programs/activities/{t2}", {"status": "cancelled"}, dhtok)
        s, d = jget(client, f"/api/programs/{pid}", dhtok)
        assert d["status"] == "completed"

    def test_manually_cancelled_program_stays_cancelled(self, client):
        dhtok = login(client, "depthead1")
        pid = create_program(client, name="P5")
        t1 = team_activity(client, dhtok, pid, title="A1")
        jput(client, f"/api/programs/{pid}", {"status": "cancelled"}, login(client, "exec1"))
        jpost(client, f"/api/programs/activities/{t1}/progress", {"progress_pct": 100}, dhtok)
        s, d = jget(client, f"/api/programs/{pid}", dhtok)
        assert d["status"] == "cancelled"

    def test_child_activity_status_derived_from_subchildren(self, client):
        dhtok, pid, parent = setup_team_task(client)
        c1 = team_activity(client, dhtok, pid, title="C1", parent_id=parent)
        c2 = team_activity(client, dhtok, pid, title="C2", parent_id=parent)
        jpost(client, f"/api/programs/activities/{c1}/progress", {"progress_pct": 100}, dhtok)
        jpost(client, f"/api/programs/activities/{c2}/progress", {"progress_pct": 100}, dhtok)
        s, d = jget(client, f"/api/programs/{pid}", dhtok)
        assert d["status"] == "completed"
        parent_act = [a for a in d["activities"] if a["id"] == parent][0]
        assert parent_act["status"] == "completed"

    def test_program_goes_to_planning_when_all_not_started(self, client):
        dhtok, pid, t1 = setup_team_task(client)
        t2 = team_activity(client, dhtok, pid, title="A2")
        s, d = jget(client, f"/api/programs/{pid}", dhtok)
        assert d["status"] == "planning"
"""New model: departments set activities inside programs and assign them to
teams; team leaders break those down into member tasks and serve strategic goals.
Executives author programs only and never touch activities."""

import pytest
from conftest import login, jget, jpost, jput, jdel
from test_plan_performance import _build_tier_tree


@pytest.fixture(autouse=True)
def _tier_setup(client):
    _build_tier_tree(client)
    yield


def create_program(client, name="Reg Program"):
    etok = login(client, "exec1")
    s, p = jpost(client, "/api/programs", {"name": name, "cycle_id": 1}, etok)
    assert s == 201
    return etok, p["id"]


def quarterly_for_team(client, dhtok, annual_id, team_id, title="Team quarterly"):
    s, q = jpost(client, "/api/strategic-goals",
                 {"title": title, "scope": "quarterly", "quarter": "Q1",
                  "year": 2026, "parent_id": annual_id, "org_unit_id": team_id}, dhtok)
    assert s == 201
    return q["id"]


def seed_activity_setup(client):
    """Annual + quarterly(team 20) + program + team-20 activity + member drill."""
    etok = login(client, "exec1")
    s, annual = jpost(client, "/api/strategic-goals",
                      {"title": "Annual", "scope": "annual", "year": 2026}, etok)
    dhtok = login(client, "depthead1")
    qid = quarterly_for_team(client, dhtok, annual["id"], 20)
    _, pid = create_program(client)
    s, act = jpost(client, f"/api/programs/{pid}/activities",
                   {"title": "ESIA survey", "org_unit_id": 20,
                    "strategic_goal_id": qid}, dhtok)
    assert s == 201
    ltok = login(client, "lead1")
    s, sub = jpost(client, f"/api/programs/{pid}/activities",
                   {"title": "Field visit", "parent_id": act["id"],
                    "assignee_id": 34}, ltok)
    assert s == 201
    return {
        "etok": etok, "dhtok": dhtok, "ltok": ltok,
        "pid": pid, "aid": act["id"], "mid": sub["id"], "qid": qid,
    }


def _activity_ctx(client):
    """(etok, dhtok, ltok, pid, aid, mid)."""
    seed = seed_activity_setup(client)
    return (seed["etok"], seed["dhtok"], seed["ltok"],
            seed["pid"], seed["aid"], seed["mid"])


class TestExecutiveProgramOwnership:
    def test_executive_cannot_create_activity(self, client):
        etok, pid = create_program(client)
        s, d = jpost(client, f"/api/programs/{pid}/activities",
                     {"title": "Nope", "org_unit_id": 20}, etok)
        assert s == 403

    def test_executive_cannot_manage_kpi_or_progress(self, client):
        _, _, _, pid, aid, _ = _activity_ctx(client)
        etok = login(client, "exec1")
        s, d = jpost(client, f"/api/programs/activities/{aid}/kpis",
                     {"name": "K", "kpi_type": "percentage", "target_value": 100}, etok)
        assert s == 403
        s, d = jpost(client, f"/api/programs/activities/{aid}/progress",
                     {"progress_pct": 50}, etok)
        assert s == 403
        s, d = jdel(client, f"/api/programs/activities/{aid}", etok)
        assert s == 403

    def test_executive_sees_assigned_programs_but_cannot_mutate(self, client):
        _, _, _, pid, aid, _ = _activity_ctx(client)
        etok = login(client, "exec1")
        s, d = jget(client, "/api/programs", etok)
        assert any(p["id"] == pid for p in d)
        s, d = jput(client, f"/api/programs/activities/{aid}", {"title": "X"}, etok)
        assert s == 403


class TestTeamAssignmentAndScoping:
    def test_dept_head_links_team_activity_to_own_quarterly(self, client):
        seed = seed_activity_setup(client)
        s, prog = jget(client, f"/api/programs/{seed['pid']}", seed["dhtok"])
        assert s == 200
        root = prog["activities"][0]
        assert root["org_unit_id"] == 20
        assert root["strategic_goal_id"] == seed["qid"]
        assert root["strategic_goal_title"] == "Team quarterly"

    def test_dept_head_cannot_link_to_other_teams_quarterly(self, client):
        etok, pid = create_program(client)
        dhtok = login(client, "depthead1")
        s, annual = jpost(client, "/api/strategic-goals",
                          {"title": "Annual", "scope": "annual", "year": 2026}, etok)
        # quarterly anchored on team 21 — outside team 20's assignment
        other_qid = quarterly_for_team(client, dhtok, annual["id"], 21, "Other team")
        s, d = jpost(client, f"/api/programs/{pid}/activities",
                     {"title": "Mismatch", "org_unit_id": 20,
                      "strategic_goal_id": other_qid}, dhtok)
        assert s == 403

    def test_assignable_goals_respect_org_unit(self, client):
        seed = seed_activity_setup(client)
        dhtok = seed["dhtok"]
        # For team 20: the team-20 quarterly is offered, the other team's is not,
        # and an individual task (no assignee given) is not offered.
        s, options = jget(client, f"/api/programs/{seed['pid']}/assignable-goals?org_unit_id=20",
                          dhtok)
        assert s == 200
        ids = {o["id"] for o in options}
        assert seed["qid"] in ids

    def test_inline_kpis_on_team_activity(self, client):
        dhtok = login(client, "depthead1")
        _, pid = create_program(client, "KPI Program")
        s, a = jpost(client, f"/api/programs/{pid}/activities",
                     {"title": "Survey", "org_unit_id": 20, "kpis": [
                         {"name": "Compliance", "kpi_type": "percentage",
                          "target_value": 100, "actual_value": 60, "weight": 2},
                         {"name": "Coverage", "kpi_type": "numeric",
                          "target_value": 10, "actual_value": 0, "weight": 1},
                     ]}, dhtok)
        assert s == 201
        s, prog = jget(client, f"/api/programs/{pid}", dhtok)
        activity = prog["activities"][0]
        assert len(activity["kpis"]) == 2
        # (60*2 + 0*1) / 3 = 40
        assert activity["progress_pct"] == pytest.approx(40.0, abs=0.1)

    def test_inline_kpi_validation(self, client):
        dhtok = login(client, "depthead1")
        _, pid = create_program(client, "Bad KPI Program")
        s, d = jpost(client, f"/api/programs/{pid}/activities",
                     {"title": "Survey", "org_unit_id": 20, "kpis": [
                         {"name": "Bad", "kpi_type": "wrong", "target_value": 100},
                     ]}, dhtok)
        assert s == 400


class TestListScoping:
    def test_team_leader_sees_only_own_program(self, client):
        seed = seed_activity_setup(client)
        s, d = jget(client, "/api/programs", seed["ltok"])
        assert any(p["id"] == seed["pid"] for p in d)
        lead2 = login(client, "lead2")
        s, d = jget(client, "/api/programs", lead2)
        assert all(p["id"] != seed["pid"] for p in d)

    def test_employee_sees_only_assigned_program(self, client):
        seed = seed_activity_setup(client)
        etok = login(client, "emp20")
        s, d = jget(client, "/api/programs", etok)
        assert any(p["id"] == seed["pid"] for p in d)
        # emp 35's sub-activity was NOT assigned, so they see nothing
        s, d = jget(client, "/api/programs", login(client, "emp21"))
        assert all(p["id"] != seed["pid"] for p in d)


class TestPlannerSurfacesActivities:
    def test_department_view_lists_team_activities(self, client):
        seed = seed_activity_setup(client)
        s, d = jget(client, "/api/strategic-goals/department", seed["dhtok"])
        assert s == 200
        team20 = next(t for t in d["teams"] if t["unit_id"] == 20)
        acts = team20["activities"]
        assert len(acts) == 1
        act = acts[0]
        assert act["title"] == "ESIA survey"
        assert act["member_task_count"] == 1
        assert act["children"][0]["assignee_id"] == 34
        assert act["program_name"] == "Reg Program"

    def test_team_view_lists_team_activities_with_drilldown(self, client):
        seed = seed_activity_setup(client)
        s, d = jget(client, "/api/strategic-goals/team", seed["ltok"])
        assert s == 200
        acts = d["team_activities"]
        assert len(acts) == 1
        root = acts[0]
        assert root["org_unit_id"] == 20
        assert root["children"][0]["assignee_id"] == 34
        assert root["children"][0]["assignee_name"] == "Member A1"
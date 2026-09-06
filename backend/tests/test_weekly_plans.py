"""Weekly plans: simple to-do lists for employees."""

from conftest import login, jget, jpost
from test_plan_performance import _build_tier_tree
import pytest


class TestWeeklyPlan:
    def test_get_empty_plan(self, client):
        tok = login(client, "employee1")
        s, d = jget(client, "/api/weekly-plans/current", tok)
        assert s == 200
        assert d["plan"] is None
        assert d["tasks"] == []

    def test_create_and_get_plan(self, client):
        tok = login(client, "employee1")
        s, d = jpost(client, "/api/weekly-plans/current",
                     {"tasks": [
                         {"title": "Task one", "status": "todo", "day_of_week": 1},
                         {"title": "Task two", "status": "done", "day_of_week": 2},
                     ]}, tok)
        assert s == 200
        assert d["ok"] is True

        s, d = jget(client, "/api/weekly-plans/current", tok)
        assert s == 200
        assert d["plan"] is not None
        assert len(d["tasks"]) == 2
        assert d["tasks"][0]["title"] == "Task one"
        assert d["tasks"][0]["status"] == "todo"
        assert d["tasks"][0]["day_of_week"] == 1
        assert d["tasks"][1]["status"] == "done"

    def test_update_replaces_tasks(self, client):
        tok = login(client, "employee1")
        jpost(client, "/api/weekly-plans/current",
              {"tasks": [{"title": "Old", "status": "todo"}]}, tok)
        jpost(client, "/api/weekly-plans/current",
              {"tasks": [{"title": "New", "status": "todo"}]}, tok)

        s, d = jget(client, "/api/weekly-plans/current", tok)
        assert len(d["tasks"]) == 1
        assert d["tasks"][0]["title"] == "New"

    def test_employee_cannot_toggle_other_plan(self, client):
        tok = login(client, "employee1")
        jpost(client, "/api/weekly-plans/current",
              {"tasks": [{"title": "Mine", "status": "todo"}]}, tok)
        s, d = jget(client, "/api/weekly-plans/current", tok)
        plan_id = d["plan"]["id"]
        task_id = d["tasks"][0]["id"]

        # Other employee tries to toggle
        etok = login(client, "employee2")
        s, d = jpost(client, f"/api/weekly-plans/{plan_id}/tasks/{task_id}/toggle", {}, etok)
        assert s == 404


class TestWeeklyPlanToggle:
    def test_toggle_cycles_states(self, client):
        tok = login(client, "employee1")
        jpost(client, "/api/weekly-plans/current",
              {"tasks": [{"title": "Task", "status": "todo"}]}, tok)
        s, d = jget(client, "/api/weekly-plans/current", tok)
        plan_id = d["plan"]["id"]
        task_id = d["tasks"][0]["id"]

        s, d = jpost(client, f"/api/weekly-plans/{plan_id}/tasks/{task_id}/toggle", {}, tok)
        assert s == 200
        assert d["status"] == "in_progress"

        s, d = jpost(client, f"/api/weekly-plans/{plan_id}/tasks/{task_id}/toggle", {}, tok)
        assert d["status"] == "done"

        s, d = jpost(client, f"/api/weekly-plans/{plan_id}/tasks/{task_id}/toggle", {}, tok)
        assert d["status"] == "todo"

    def test_set_status(self, client):
        tok = login(client, "employee1")
        jpost(client, "/api/weekly-plans/current",
              {"tasks": [{"title": "Task", "status": "todo"}]}, tok)
        s, d = jget(client, "/api/weekly-plans/current", tok)
        plan_id = d["plan"]["id"]
        task_id = d["tasks"][0]["id"]

        s, d = jpost(client, f"/api/weekly-plans/{plan_id}/tasks/{task_id}/status",
                     {"status": "done"}, tok)
        assert s == 200
        assert d["status"] == "done"

        s, d = jpost(client, f"/api/weekly-plans/{plan_id}/tasks/{task_id}/status",
                     {"status": "invalid"}, tok)
        assert s == 400


class TestWeeklyPlanSummary:
    def test_manager_can_view_summary(self, client):
        tok = login(client, "manager1")
        s, d = jget(client, "/api/weekly-plans/summary", tok)
        assert s == 200
        assert "summaries" in d
        # manager1 (employee 3) has reports 5, 6
        assert len(d["summaries"]) == 2

    def test_employee_blocked_from_summary(self, client):
        tok = login(client, "employee1")
        s, d = jget(client, "/api/weekly-plans/summary", tok)
        assert s == 403

    def test_summary_counts(self, client):
        etok = login(client, "employee1")
        jpost(client, "/api/weekly-plans/current",
              {"tasks": [
                  {"title": "Done", "status": "done"},
                  {"title": "Active", "status": "in_progress"},
              ]}, etok)

        mtok = login(client, "manager1")
        s, d = jget(client, "/api/weekly-plans/summary", mtok)
        assert s == 200
        emp = next(x for x in d["summaries"] if x["employee_id"] == 5)
        assert emp["total_tasks"] == 2
        assert emp["done_tasks"] == 1
        assert emp["completion_pct"] == 50


class TestSupervisorPlanAuthoring:
    """Dept heads / team leaders author & assign a member's weekly plan —
    synthesizing the quarterly plan into weeks and days."""

    @pytest.fixture(autouse=True)
    def _tier_setup(self, client):
        _build_tier_tree(client)
        yield

    def _goal_for_member(self, client, member_id=34):
        etok = login(client, "exec1")
        s, annual = jpost(client, "/api/strategic-goals",
                          {"title": "Annual plan", "scope": "annual", "year": 2026}, etok)
        dhtok = login(client, "depthead1")
        s, quarter = jpost(client, "/api/strategic-goals",
                           {"title": "Team A quarterly", "scope": "quarterly",
                            "quarter": "Q1", "year": 2026,
                            "parent_id": annual["id"], "org_unit_id": 20}, dhtok)
        ltok = login(client, "lead1")
        s, d = jpost(client, f"/api/strategic-goals/{quarter['id']}/assign",
                     {"assignments": [
                         {"title": "ESIA review", "assigned_to_id": member_id,
                          "kpis": [{"name": "Pages", "kpi_type": "numeric",
                                    "target_value": 100}]},
                     ]}, ltok)
        assert s == 200
        return ltok, d["created"][0]

    def test_leader_writes_member_plan_with_days(self, client):
        ltok, gid = self._goal_for_member(client, 34)
        s, d = jpost(client, "/api/weekly-plans/34/current", {"tasks": [
            {"title": "Draft pages", "status": "in_progress",
             "day_of_week": 2, "strategic_goal_id": gid},
            {"title": "Review", "status": "todo", "day_of_week": 4},
        ]}, ltok)
        assert s == 200

        mtok = login(client, "emp20")
        s, d = jget(client, "/api/weekly-plans/current", mtok)
        assert s == 200
        assert len(d["tasks"]) == 2
        assert d["tasks"][0]["strategic_goal_id"] == gid
        assert d["tasks"][1]["day_of_week"] == 4

    def test_dept_head_can_author_member_plan(self, client):
        self._goal_for_member(client, 34)
        dhtok = login(client, "depthead1")
        s, d = jpost(client, "/api/weekly-plans/34/current", {"tasks": [
            {"title": "Run the week", "status": "todo"},
        ]}, dhtok)
        assert s == 200

    def test_cannot_schedule_other_members_goal(self, client):
        ltok, gid35 = self._goal_for_member(client, 35)
        s, d = jpost(client, "/api/weekly-plans/34/current", {"tasks": [
            {"title": "Wrong", "strategic_goal_id": gid35},
        ]}, ltok)
        assert s == 400

    def test_cannot_author_outside_scope(self, client):
        ltok, gid = self._goal_for_member(client, 34)
        # emp 36 is in team B, outside lead1's team
        s, d = jpost(client, "/api/weekly-plans/36/current", {"tasks": [
            {"title": "Sneaky", "strategic_goal_id": gid},
        ]}, ltok)
        assert s == 403

    def test_employee_cannot_author_other_plans(self, client):
        s, d = jpost(client, "/api/weekly-plans/5/current", {"tasks": []},
                     login(client, "employee1"))
        assert s == 403

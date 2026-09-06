"""Cascade authorship + compartmentation for the plan pipeline.

  annual=executive -> quarterly=director -> team=dept_head -> individual=team_leader

Compartmentation (top-down cap, upward breadcrumbs allowed):
  - exec/director never see team or individual rows (department aggregates only)
  - dept_head plans per team / sees team aggregates only
  - team_leader sees their team's plan + members' tasks
  - member sees only their own assigned tasks + the upward "why" chain
"""

import sqlite3
import pytest

from conftest import login, jget, jpost, jput, _test_db
from test_plan_performance import _build_tier_tree


@pytest.fixture(autouse=True)
def _tier_setup(client):
    _build_tier_tree(client)
    yield


def _make_chain(client):
    """exec annual -> director quarterly -> dept-head team plans -> member tasks.
    Returns dict of goal ids for reuse."""
    etok = login(client, "exec1")
    s, annual = jpost(client, "/api/strategic-goals",
                      {"title": "Annual plan", "scope": "annual", "year": 2026}, etok)

    dtok = login(client, "director1")
    s, quarterly = jpost(client, "/api/strategic-goals",
                         {"title": "Directorate Q1", "scope": "quarterly",
                          "quarter": "Q1", "year": 2026, "parent_id": annual["id"]}, dtok)

    dhtok = login(client, "depthead1")
    s, d = jpost(client, f"/api/strategic-goals/{quarterly['id']}/assign",
                 {"assignments": [
                     {"title": "Team A plan", "org_unit_id": 20},
                     {"title": "Team B plan", "org_unit_id": 21},
                 ]}, dhtok)
    assert s == 200
    team_plan_a, team_plan_b = d["created"]

    ltok = login(client, "lead1")
    s, d = jpost(client, f"/api/strategic-goals/{team_plan_a}/assign",
                 {"assignments": [
                     {"title": "Member task", "assigned_to_id": 34,
                      "kpis": [{"name": "Output target", "kpi_type": "numeric",
                                "target_value": 5}]},
                 ]}, ltok)
    assert s == 200
    task_34 = d["created"][0]

    return {
        "etok": etok, "dtok": dtok, "dhtok": dhtok, "ltok": ltok,
        "annual": annual["id"], "quarterly": quarterly["id"],
        "team_plan_a": team_plan_a, "team_plan_b": team_plan_b, "task_34": task_34,
    }


class TestAuthorshipMatrix:
    def test_admin_cannot_author(self, client):
        tok = login(client, "admin1")
        s, d = jpost(client, "/api/strategic-goals",
                     {"title": "Annual", "scope": "annual", "year": 2026}, tok)
        assert s == 403

    def test_exec_only_annual_and_no_cascade_down(self, client):
        chain = _make_chain(client)
        s, d = jpost(client, f"/api/strategic-goals/{chain['annual']}/assign",
                     {"assignments": [{"title": "Not director work", "quarter": "Q1"}]},
                     chain["etok"])
        assert s == 403

    def test_director_only_quarterly(self, client):
        chain = _make_chain(client)
        # director cannot author the next level down or up
        s, d = jpost(client, "/api/strategic-goals",
                     {"title": "Not dept work", "scope": "team"}, chain["dtok"])
        assert s == 403
        s, d = jpost(client, "/api/strategic-goals",
                     {"title": "Not exec work", "scope": "annual", "year": 2026},
                     chain["dtok"])
        assert s == 403

    def test_dept_head_only_team(self, client):
        chain = _make_chain(client)
        # dept head cannot synthesize individual tasks (that is the team lead's job)
        s, d = jpost(client, f"/api/strategic-goals/{chain['team_plan_a']}/assign",
                     {"assignments": [{"title": "bad", "assigned_to_id": 34}]},
                     chain["dhtok"])
        assert s == 403

    def test_team_leader_only_individual(self, client):
        chain = _make_chain(client)
        # team lead cannot synthesize team plans from a quarterly
        s, d = jpost(client, f"/api/strategic-goals/{chain['quarterly']}/assign",
                     {"assignments": [{"title": "bad", "org_unit_id": 20}]},
                     chain["ltok"])
        assert s == 403

    def test_member_cannot_author(self, client):
        tok = login(client, "emp20")
        s, d = jpost(client, "/api/strategic-goals",
                     {"title": "my task", "scope": "individual"}, tok)
        assert s == 403


class TestOrdination:
    def test_dept_head_cannot_pivot_foreign_quarterly(self, client):
        chain = _make_chain(client)
        # Plant a quarterly owned by directorate d2 directly.
        conn = sqlite3.connect(_test_db)
        conn.row_factory = sqlite3.Row
        conn.execute(
            "INSERT INTO strategic_goals (parent_id, title, scope, owner_id, org_unit_id, "
            "quarter, year, status) VALUES (?, 'Foreign Q', 'quarterly', 30, 2, 'Q1', 2026, 'draft')",
            (chain["annual"],))
        conn.commit()
        foreign_qid = conn.execute(
            "SELECT id FROM strategic_goals WHERE title='Foreign Q'"
        ).fetchone()["id"]
        conn.close()

        s, d = jpost(client, f"/api/strategic-goals/{foreign_qid}/assign",
                     {"assignments": [{"title": "bad", "org_unit_id": 20}]}, chain["dhtok"])
        assert s == 403

    def test_dept_head_cannot_target_outside_department(self, client):
        chain = _make_chain(client)
        # dept 10's head must not assign a plan to finance team (unit 22, corporate services)
        s, d = jpost(client, f"/api/strategic-goals/{chain['quarterly']}/assign",
                     {"assignments": [{"title": "bad", "org_unit_id": 22}]}, chain["dhtok"])
        assert s == 403

    def test_team_lead_cannot_assign_outside_team(self, client):
        chain = _make_chain(client)
        # emp22 belongs to team B; lead1 heads team A
        s, d = jpost(client, f"/api/strategic-goals/{chain['team_plan_a']}/assign",
                     {"assignments": [{"title": "bad", "assigned_to_id": 36}]}, chain["ltok"])
        assert s == 403

    def test_team_lead_cannot_source_other_teams_plan(self, client):
        chain = _make_chain(client)
        # lead1 must not synthesize tasks from team B's plan
        s, d = jpost(client, f"/api/strategic-goals/{chain['team_plan_b']}/assign",
                     {"assignments": [{"title": "bad", "assigned_to_id": 34}]}, chain["ltok"])
        assert s == 403

    def test_director_cannot_lead_to_other_directorate(self, client):
        # director1 (unit 1) pins a quarterly to unit 2 -> forbidden
        tok = login(client, "exec1")
        s, annual = jpost(client, "/api/strategic-goals",
                          {"title": "Annual", "scope": "annual", "year": 2026}, tok)
        dtok = login(client, "director1")
        s, d = jpost(client, "/api/strategic-goals",
                     {"title": "bad", "scope": "quarterly", "quarter": "Q1",
                      "year": 2026, "parent_id": annual["id"], "org_unit_id": 2}, dtok)
        assert s == 403


class TestCompartmentation:
    def test_director_tree_never_shows_team_or_individual(self, client):
        chain = _make_chain(client)
        s, tree = jget(client, "/api/strategic-goals/tree", chain["dtok"])
        assert s == 200

        def scopes(nodes, acc):
            for n in nodes:
                acc.add(n["scope"])
                scopes(n.get("children", []), acc)
            return acc

        used = scopes(tree, set())
        assert "team" not in used
        assert "individual" not in used
        assert "department" in used

    def test_dept_head_planner_is_team_aggregated(self, client):
        chain = _make_chain(client)
        s, data = jget(client, "/api/strategic-goals/department", chain["dhtok"])
        assert s == 200
        names = {t["unit_name"]: t for t in data["teams"]}
        assert "ESIA Team A" in names and "ESIA Team B" in names
        # plans carry only team-aggregated progress, never member rows
        plan_a = names["ESIA Team A"]["plans"][0]
        assert "tasks_assigned" in plan_a
        assert any(q["id"] == chain["quarterly"] for q in data["quarterlies"])

    def test_non_dept_head_blocked_from_dept_planner(self, client):
        chain = _make_chain(client)
        for tok in (chain["ltok"], chain["etok"]):
            s, d = jget(client, "/api/strategic-goals/department", tok)
            assert s == 403

    def test_team_leader_planner_shows_members_with_tasks(self, client):
        chain = _make_chain(client)
        s, data = jget(client, "/api/strategic-goals/team", chain["ltok"])
        assert s == 200
        assert len(data["plans"]) == 1
        assert data["plans"][0]["id"] == chain["team_plan_a"]
        # upward "why" chain: annual -> quarterly -> team plan
        assert len(data["anchors"][0]) == 2
        member = next(m for m in data["members"] if m["id"] == 34)
        assert [t["id"] for t in member["tasks"]] == [chain["task_34"]]

    def test_member_assigned_inbox_has_breadcrumb_only(self, client):
        chain = _make_chain(client)
        mtok = login(client, "emp20")
        s, data = jget(client, "/api/strategic-goals/assigned", mtok)
        assert s == 200
        assert len(data) == 1
        assert data[0]["id"] == chain["task_34"]
        crumb_scopes = [c["scope"] for c in data[0]["breadcrumb"]]
        assert crumb_scopes == ["annual", "quarterly", "team"]

    def test_member_sees_only_own_tasks(self, client):
        chain = _make_chain(client)
        # give emp21 a task too
        ltok = login(client, "lead1")
        jpost(client, f"/api/strategic-goals/{chain['team_plan_a']}/assign",
              {"assignments": [{"title": "emp21 task", "assigned_to_id": 35,
                                "kpis": [{"name": "Output", "kpi_type": "numeric",
                                          "target_value": 1}]}]}, ltok)
        mtok = login(client, "emp20")
        s, data = jget(client, "/api/strategic-goals/assigned", mtok)
        assert len(data) == 1
        assert data[0]["id"] == chain["task_34"]

    def test_other_role_blocked_from_assigned_scope_leak(self, client):
        # lead2 (team B) must not see team A's member tasks via /assigned
        chain = _make_chain(client)
        l2tok = login(client, "lead2")
        s, data = jget(client, "/api/strategic-goals/assigned", l2tok)
        assert s == 200
        assert data == []


class TestWeeklyLinking:
    def test_cannot_link_unassigned_goal(self, client):
        chain = _make_chain(client)
        mtok = login(client, "emp20")
        # emp20 links emp21's (nonexistent here) own task: use a goal assigned to emp21
        ltok = login(client, "lead1")
        s, d = jpost(client, f"/api/strategic-goals/{chain['team_plan_a']}/assign",
                     {"assignments": [{"title": "for emp21", "assigned_to_id": 35,
                                       "kpis": [{"name": "Output", "kpi_type": "numeric",
                                                 "target_value": 1}]}]}, ltok)
        other_task = d["created"][0]

        s, d = jpost(client, "/api/weekly-plans/current",
                     {"tasks": [{"title": "sneaky", "strategic_goal_id": other_task}]}, mtok)
        assert s == 400

    def test_link_own_assigned_goal_ok(self, client):
        chain = _make_chain(client)
        mtok = login(client, "emp20")
        s, d = jpost(client, "/api/weekly-plans/current",
                     {"tasks": [
                         {"title": "work", "strategic_goal_id": chain["task_34"],
                          "status": "done", "day_of_week": 1},
                         {"title": "todo item", "strategic_goal_id": chain["task_34"],
                          "status": "todo", "day_of_week": 2},
                     ]}, mtok)
        assert s == 200

        s, inbox = jget(client, "/api/strategic-goals/assigned", mtok)
        assert s == 200
        assert inbox[0]["progress_pct"] == 50

        # team leader sees the member's rolled-up progress too
        s, data = jget(client, "/api/strategic-goals/team", chain["ltok"])
        member = next(m for m in data["members"] if m["id"] == 34)
        assert member["tasks"][0]["progress_pct"] == 50

        # department head sees the plan at team-aggregated level
        s, data = jget(client, "/api/strategic-goals/department", chain["dhtok"])
        team_a = next(t for t in data["teams"] if t["unit_id"] == 20)
        assert team_a["plans"][0]["progress_pct"] == 50

    def test_linked_goal_rolls_into_exec_department_node(self, client):
        chain = _make_chain(client)
        mtok = login(client, "emp20")
        jpost(client, "/api/weekly-plans/current",
              {"tasks": [{"title": "work", "strategic_goal_id": chain["task_34"],
                          "status": "done", "day_of_week": 1}]}, mtok)

        s, tree = jget(client, "/api/strategic-goals/tree", chain["etok"])
        assert s == 200

        def nodes(ns, acc):
            for n in ns:
                acc.append(n)
                nodes(n.get("children", []), acc)
            return acc

        dept_nodes = [n for n in nodes(tree, []) if n["scope"] == "department"]
        assert dept_nodes, "executive tree must include department aggregates"
        # dept aggregates average its team plans: team A = 100 (linked task done),
        # team B = 0 (no tasks yet) -> 50
        assert dept_nodes[0]["progress_pct"] == 50


class TestUpdateRules:
    def test_exec_cannot_update_quarterly(self, client):
        chain = _make_chain(client)
        s, d = jput(client, f"/api/strategic-goals/{chain['quarterly']}",
                    {"status": "active"}, chain["etok"])
        assert s == 403

    def test_owner_can_update_own_goal(self, client):
        chain = _make_chain(client)
        s, d = jput(client, f"/api/strategic-goals/{chain['team_plan_a']}",
                    {"status": "active"}, chain["dhtok"])
        assert s == 200
"""Strategic goals: cascading annual → quarterly → team → individual.

The cascade is authored strictly by the owning actor per level:
  annual=executive, quarterly=director, team=dept_head, individual=team_leader.
"""

import pytest
from conftest import login, jget, jpost, jput, jdel
from test_plan_performance import _build_tier_tree


@pytest.fixture(autouse=True)
def _tier_setup(client):
    _build_tier_tree(client)
    yield


class TestCreateStrategicGoal:
    def test_employee_cannot_create(self, client):
        tok = login(client, "employee1")
        s, d = jpost(client, "/api/strategic-goals",
                     {"title": "My goal", "scope": "annual"}, tok)
        assert s == 403

    def test_manager_cannot_create_annual(self, client):
        tok = login(client, "manager1")
        s, d = jpost(client, "/api/strategic-goals",
                     {"title": "Annual goal", "scope": "annual"}, tok)
        assert s == 403

    def test_executive_can_create_annual(self, client):
        tok = login(client, "exec1")
        s, d = jpost(client, "/api/strategic-goals",
                     {"title": "Reduce ESIA backlog", "scope": "annual", "year": 2026}, tok)
        assert s == 201
        assert "id" in d

    def test_director_cannot_create_annual(self, client):
        tok = login(client, "director1")
        s, d = jpost(client, "/api/strategic-goals",
                     {"title": "Not my job", "scope": "annual", "year": 2026}, tok)
        assert s == 403

    def test_executive_cannot_create_quarterly(self, client):
        tok = login(client, "exec1")
        s, parent = jpost(client, "/api/strategic-goals",
                          {"title": "Annual", "scope": "annual", "year": 2026}, tok)
        assert s == 201
        s, d = jpost(client, "/api/strategic-goals",
                     {"title": "Not exec work", "scope": "quarterly", "quarter": "Q1",
                      "year": 2026, "parent_id": parent["id"]}, tok)
        assert s == 403

    def test_director_cannot_create_team(self, client):
        tok = login(client, "director1")
        s, d = jpost(client, "/api/strategic-goals",
                     {"title": "Not my job", "scope": "team"}, tok)
        assert s == 403

    def test_invalid_scope(self, client):
        tok = login(client, "exec1")
        s, d = jpost(client, "/api/strategic-goals",
                     {"title": "Bad", "scope": "nonsense"}, tok)
        assert s == 400

    def test_missing_title(self, client):
        tok = login(client, "exec1")
        s, d = jpost(client, "/api/strategic-goals", {"scope": "annual"}, tok)
        assert s == 400


class TestStrategicGoalCascade:
    def test_director_cascades_annual_to_quarterly(self, client):
        etok = login(client, "exec1")
        s, parent = jpost(client, "/api/strategic-goals",
                          {"title": "Annual", "scope": "annual", "year": 2026}, etok)
        parent_id = parent["id"]

        dtok = login(client, "director1")
        s, child = jpost(client, "/api/strategic-goals",
                         {"title": "Directorate Q1", "scope": "quarterly",
                          "quarter": "Q1", "year": 2026, "parent_id": parent_id}, dtok)
        assert s == 201

        s, d = jget(client, f"/api/strategic-goals/{parent_id}", etok)
        assert s == 200
        assert len(d["children"]) == 1
        assert d["children"][0]["title"] == "Directorate Q1"

    def test_invalid_child_scope(self, client):
        etok = login(client, "exec1")
        s, parent = jpost(client, "/api/strategic-goals",
                          {"title": "Annual", "scope": "annual", "year": 2026}, etok)
        parent_id = parent["id"]

        # Cannot create an annual under an annual
        s, d = jpost(client, "/api/strategic-goals",
                     {"title": "Nested annual", "scope": "annual", "parent_id": parent_id}, etok)
        assert s == 400

    def test_assign_cascade_requires_director(self, client):
        etok = login(client, "exec1")
        s, parent = jpost(client, "/api/strategic-goals",
                          {"title": "Annual", "scope": "annual", "year": 2026}, etok)
        parent_id = parent["id"]

        # Executive is NOT the quarterly author anymore
        s, d = jpost(client, f"/api/strategic-goals/{parent_id}/assign",
                     {"assignments": [
                         {"title": "Q1 goal", "quarter": "Q1"},
                     ]}, etok)
        assert s == 403

        dtok = login(client, "director1")
        s, d = jpost(client, f"/api/strategic-goals/{parent_id}/assign",
                     {"assignments": [
                         {"title": "Q1 goal", "quarter": "Q1"},
                         {"title": "Q2 goal", "quarter": "Q2"},
                     ]}, dtok)
        assert s == 200
        assert len(d["created"]) == 2
        assert d["child_scope"] == "quarterly"

    def test_quarterly_outside_own_directorate_rejected(self, client):
        etok = login(client, "exec1")
        s, annual = jpost(client, "/api/strategic-goals",
                          {"title": "Annual", "scope": "annual", "year": 2026}, etok)

        dtok = login(client, "director1")
        # director1 heads directorate d1 (unit 1). Try to pivot a quarterly
        # onto directorate d2 (unit 2) -> forbidden.
        s, d = jpost(client, "/api/strategic-goals",
                     {"title": "Other dept", "scope": "quarterly",
                      "quarter": "Q1", "year": 2026,
                      "parent_id": annual["id"], "org_unit_id": 2}, dtok)
        assert s == 403


class TestStrategicGoalVisibility:
    def test_executive_sees_annuals(self, client):
        tok = login(client, "exec1")
        jpost(client, "/api/strategic-goals",
              {"title": "Annual", "scope": "annual", "year": 2026}, tok)
        s, d = jget(client, "/api/strategic-goals", tok)
        assert s == 200
        assert len(d) >= 1

    def test_executive_tree_never_shows_team_or_individual(self, client):
        etok = login(client, "exec1")
        s, annual = jpost(client, "/api/strategic-goals",
                          {"title": "Annual", "scope": "annual", "year": 2026}, etok)

        dtok = login(client, "director1")
        s, quarterly = jpost(client, "/api/strategic-goals",
                             {"title": "Directorate Q1", "scope": "quarterly",
                              "quarter": "Q1", "year": 2026,
                              "parent_id": annual["id"]}, dtok)

        # Dept head + team lead synthesize below the quarterly
        dhtok = login(client, "depthead1")
        s, d = jpost(client, f"/api/strategic-goals/{quarterly['id']}/assign",
                     {"assignments": [
                         {"title": "Team A plan", "org_unit_id": 20},
                         {"title": "Team B plan", "org_unit_id": 21},
                     ]}, dhtok)
        assert s == 200
        team_plan_a = d["created"][0]

        ltok = login(client, "lead1")
        s, d = jpost(client, f"/api/strategic-goals/{team_plan_a}/assign",
                     {"assignments": [
                         {"title": "Task for member", "assigned_to_id": 34,
                          "kpis": [{"name": "Deliverable", "kpi_type": "numeric",
                                    "target_value": 1}]},
                     ]}, ltok)
        assert s == 200

        s, tree = jget(client, "/api/strategic-goals/tree", etok)
        assert s == 200

        def scopes(nodes, acc):
            for n in nodes:
                acc.add(n["scope"])
                scopes(n.get("children", []), acc)
            return acc

        used = scopes(tree, set())
        assert "team" not in used
        assert "individual" not in used
        # department aggregate rolled up
        assert "department" in used

    def test_employee_sees_org_wide(self, client):
        tok = login(client, "exec1")
        jpost(client, "/api/strategic-goals",
              {"title": "Annual", "scope": "annual", "year": 2026}, tok)

        etok = login(client, "employee1")
        s, d = jget(client, "/api/strategic-goals", etok)
        assert s == 200
        titles = [g["title"] for g in d]
        assert "Annual" in titles

    def test_tree_endpoint(self, client):
        etok = login(client, "exec1")
        s, parent = jpost(client, "/api/strategic-goals",
                          {"title": "Annual", "scope": "annual", "year": 2026}, etok)
        parent_id = parent["id"]

        dtok = login(client, "director1")
        jpost(client, "/api/strategic-goals",
              {"title": "Quarterly", "scope": "quarterly", "quarter": "Q1",
               "year": 2026, "parent_id": parent_id}, dtok)

        s, d = jget(client, "/api/strategic-goals/tree", etok)
        assert s == 200
        assert len(d) == 1
        assert len(d[0]["children"]) == 1


class TestStrategicGoalUpdate:
    def test_owner_can_update_status(self, client):
        tok = login(client, "exec1")
        s, g = jpost(client, "/api/strategic-goals",
                     {"title": "Annual", "scope": "annual", "year": 2026}, tok)
        s, d = jput(client, f"/api/strategic-goals/{g['id']}",
                    {"status": "active", "progress_pct": 50}, tok)
        assert s == 200

        s, d = jget(client, f"/api/strategic-goals/{g['id']}", tok)
        assert d["status"] == "active"
        assert d["progress_pct"] == 50

    def test_nonowner_cannot_update(self, client):
        tok = login(client, "exec1")
        s, g = jpost(client, "/api/strategic-goals",
                     {"title": "Annual", "scope": "annual", "year": 2026}, tok)

        mtok = login(client, "manager1")
        s, d = jput(client, f"/api/strategic-goals/{g['id']}",
                    {"status": "completed"}, mtok)
        assert s == 403


class TestStrategicGoalProgramLink:
    """Grand plans are coined from programs: an annual goal links to a source
    program, the grand-plan rollup surfaces it, and the link flows down the
    goal tree (annual -> quarterly -> team -> individual)."""

    def _seed_program(self, client, tok, name="ESIA Modernization"):
        s, p = jpost(client, "/api/programs", {"name": name, "cycle_id": 1}, tok)
        assert s == 201
        return p["id"]

    def test_executive_coins_annual_from_program(self, client):
        etok = login(client, "exec1")
        pid = self._seed_program(client, etok)

        s, g = jpost(client, "/api/strategic-goals",
                     {"title": "Grand goal", "scope": "annual", "year": 2026,
                      "program_id": pid}, etok)
        assert s == 201

        s, plan = jget(client, "/api/tiers/grand-plan", etok)
        assert s == 200
        match = next((x for x in plan["goals"] if x["id"] == g["id"]), None)
        assert match is not None
        assert match["program_id"] == pid
        assert match["program_name"] == "ESIA Modernization"

    def test_program_link_cascades_to_quarterly(self, client):
        etok = login(client, "exec1")
        pid = self._seed_program(client, etok, name="Regulatory Upgrade")
        s, annual = jpost(client, "/api/strategic-goals",
                          {"title": "Annual", "scope": "annual", "year": 2026,
                           "program_id": pid}, etok)
        assert s == 201

        dtok = login(client, "director1")
        s, child = jpost(client, "/api/strategic-goals",
                         {"title": "Directorate Q1", "scope": "quarterly",
                          "quarter": "Q1", "year": 2026,
                          "parent_id": annual["id"]}, dtok)
        assert s == 201

        s, d = jget(client, f"/api/strategic-goals/{child['id']}", etok)
        assert s == 200
        assert d["program_id"] == pid
        assert d["program_name"] == "Regulatory Upgrade"

    def test_annual_goal_tree_exposes_program_name(self, client):
        etok = login(client, "exec1")
        pid = self._seed_program(client, etok, name="Green Flagship")
        jpost(client, "/api/strategic-goals",
              {"title": "Annual", "scope": "annual", "year": 2026,
               "program_id": pid}, etok)

        s, tree = jget(client, "/api/strategic-goals/tree", etok)
        assert s == 200
        assert tree[0]["program_id"] == pid
        assert tree[0]["program_name"] == "Green Flagship"

    def test_invalid_program_rejected(self, client):
        etok = login(client, "exec1")
        s, d = jpost(client, "/api/strategic-goals",
                     {"title": "Bad", "scope": "annual", "year": 2026,
                      "program_id": 99999}, etok)
        assert s == 400

    def test_only_annual_goal_can_be_coin(self, client):
        etok = login(client, "exec1")
        pid = self._seed_program(client, etok)
        s, annual = jpost(client, "/api/strategic-goals",
                          {"title": "Annual", "scope": "annual", "year": 2026}, etok)

        dtok = login(client, "director1")
        s, d = jpost(client, "/api/strategic-goals",
                     {"title": "Q1", "scope": "quarterly", "quarter": "Q1",
                      "year": 2026, "parent_id": annual["id"], "program_id": pid}, dtok)
        assert s == 400


class TestStrategicGoalKpis:
    """Every individual (member) task set by a team leader must carry a KPI."""

    def _chain_to_team_plan(self, client):
        """Annual -> quarterly -> team plan. Returns (tokens, team_plan_id)."""
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
                     ]}, dhtok)
        assert s == 200
        return {"etok": etok, "dtok": dtok, "dhtok": dhtok}, d["created"][0]

    def _team_task(self, client, kpis):
        _, team_plan_a = self._chain_to_team_plan(client)
        ltok = login(client, "lead1")
        s, d = jpost(client, f"/api/strategic-goals/{team_plan_a}/assign",
                     {"assignments": [
                         {"title": "Deliver report", "assigned_to_id": 34,
                          "kpis": kpis},
                     ]}, ltok)
        assert s == 200
        return ltok, d["created"][0]

    def test_individual_task_requires_kpi_on_assign(self, client):
        _, team_plan_a = self._chain_to_team_plan(client)
        ltok = login(client, "lead1")
        s, d = jpost(client, f"/api/strategic-goals/{team_plan_a}/assign",
                     {"assignments": [
                         {"title": "No KPI task", "assigned_to_id": 34},
                     ]}, ltok)
        assert s == 400
        assert "KPI" in d["error"]

    def test_individual_task_requires_kpi_on_direct_create(self, client):
        _, team_plan_a = self._chain_to_team_plan(client)
        ltok = login(client, "lead1")
        s, d = jpost(client, "/api/strategic-goals",
                     {"title": "No KPI", "scope": "individual",
                      "parent_id": team_plan_a, "assigned_to_id": 34}, ltok)
        assert s == 400
        assert "KPI" in d["error"]

    def test_malformed_kpis_rejected(self, client):
        ltok = login(client, "lead1")
        _, team_plan_a = self._chain_to_team_plan(client)
        s, d = jpost(client, f"/api/strategic-goals/{team_plan_a}/assign",
                     {"assignments": [
                         {"title": "Deliver", "assigned_to_id": 34,
                          "kpis": "not-a-list"},
                     ]}, ltok)
        assert s == 400
        s, d = jpost(client, f"/api/strategic-goals/{team_plan_a}/assign",
                     {"assignments": [
                         {"title": "Deliver", "assigned_to_id": 34,
                          "kpis": [{"name": "", "kpi_type": "bogus"}]},
                     ]}, ltok)
        assert s == 400

    def test_member_task_with_kpi_is_created_and_surfaced(self, client):
        ltok, task_id = self._team_task(client, [
            {"name": "Report pages", "kpi_type": "numeric", "target_value": 40, "unit": "pages"},
            {"name": "Quality gate", "kpi_type": "milestone", "target_value": 1},
        ])

        s, detail = jget(client, f"/api/strategic-goals/{task_id}", ltok)
        assert s == 200
        assert len(detail["kpis"]) == 2
        assert detail["kpis"][0]["unit"] == "pages"
        assert detail["kpis"][1]["kpi_type"] == "milestone"

        s, data = jget(client, "/api/strategic-goals/team", ltok)
        assert s == 200
        member = next(m for m in data["members"] if m["id"] == 34)
        task = member["tasks"][0]
        assert len(task["kpis"]) == 2
        assert task["kpi_pct"] is None  # no actuals recorded yet

        mtok = login(client, "emp20")
        s, inbox = jget(client, "/api/strategic-goals/assigned", mtok)
        assert inbox[0]["id"] == task_id
        assert len(inbox[0]["kpis"]) == 2

    def test_kpi_achievement_reflected_after_actuals(self, client):
        ltok, task_id = self._team_task(client, [
            {"name": "Report pages", "kpi_type": "numeric", "target_value": 100},
            {"name": "Quality gate", "kpi_type": "milestone", "target_value": 1},
        ])

        s, kpis = jget(client, f"/api/strategic-goals/{task_id}/kpis", ltok)
        assert s == 200
        page_kpi = next(k for k in kpis if k["kpi_type"] == "numeric")
        gate_kpi = next(k for k in kpis if k["kpi_type"] == "milestone")

        mtok = login(client, "emp20")
        s, _ = jput(client, f"/api/strategic-goals/kpis/{page_kpi['id']}",
                    {"actual_value": 50}, mtok)
        assert s == 200
        s, _ = jput(client, f"/api/strategic-goals/kpis/{gate_kpi['id']}",
                    {"actual_value": 1}, mtok)
        assert s == 200

        s, inbox = jget(client, "/api/strategic-goals/assigned", mtok)
        assert inbox[0]["kpi_pct"] == 75  # (0.5 + 1.0) / 2

    def test_assignee_cannot_edit_kpi_definition(self, client):
        ltok, task_id = self._team_task(client, [
            {"name": "Pages", "kpi_type": "numeric", "target_value": 10},
        ])
        s, kpis = jget(client, f"/api/strategic-goals/{task_id}/kpis", ltok)
        kpi_id = kpis[0]["id"]

        mtok = login(client, "emp20")
        s, d = jput(client, f"/api/strategic-goals/kpis/{kpi_id}",
                    {"target_value": 999}, mtok)
        assert s == 403
        s, d = jput(client, f"/api/strategic-goals/kpis/{kpi_id}",
                    {"actual_value": 5}, mtok)
        assert s == 200

    def test_unrelated_user_cannot_touch_kpis(self, client):
        ltok, task_id = self._team_task(client, [
            {"name": "Pages", "kpi_type": "numeric", "target_value": 10},
        ])
        s, kpis = jget(client, f"/api/strategic-goals/{task_id}/kpis", ltok)
        kpi_id = kpis[0]["id"]

        other = login(client, "emp21")
        s, d = jput(client, f"/api/strategic-goals/kpis/{kpi_id}",
                    {"actual_value": 1}, other)
        assert s == 403
        s, d = jdel(client, f"/api/strategic-goals/kpis/{kpi_id}", other)
        assert s == 403

    def test_owner_can_delete_middle_kpi_but_not_last(self, client):
        ltok, task_id = self._team_task(client, [
            {"name": "A", "kpi_type": "numeric", "target_value": 10},
            {"name": "B", "kpi_type": "numeric", "target_value": 5},
        ])
        s, kpis = jget(client, f"/api/strategic-goals/{task_id}/kpis", ltok)
        a, b = kpis[0], kpis[1]

        s, d = jdel(client, f"/api/strategic-goals/kpis/{a['id']}", ltok)
        assert s == 200
        s, d = jdel(client, f"/api/strategic-goals/kpis/{b['id']}", ltok)
        assert s == 400  # a member task must keep at least one KPI

    def test_owner_can_add_kpi(self, client):
        ltok, task_id = self._team_task(client, [
            {"name": "A", "kpi_type": "numeric", "target_value": 10},
        ])
        s, d = jpost(client, f"/api/strategic-goals/{task_id}/kpis",
                     {"name": "B", "kpi_type": "milestone", "target_value": 1}, ltok)
        assert s == 201
        s, kpis = jget(client, f"/api/strategic-goals/{task_id}/kpis", ltok)
        assert len(kpis) == 2

        s, d = jpost(client, f"/api/strategic-goals/{task_id}/kpis",
                     {"name": "", "kpi_type": "numeric"}, ltok)
        assert s == 400


class TestDeptHeadQuarterlyPlans:
    """Department heads assign a quarterly plan per team; the team leader then
    synthesizes it into individual member tasks (weeks & days follow on the
    weekly-plans side)."""

    def _annual(self, client, etok):
        s, g = jpost(client, "/api/strategic-goals",
                     {"title": "Annual plan", "scope": "annual", "year": 2026}, etok)
        assert s == 201
        return g["id"]

    def _dept_quarterly_for_team(self, client, dhtok, annual_id, team_id=20, title="Team A quarterly"):
        s, g = jpost(client, "/api/strategic-goals",
                     {"title": title, "scope": "quarterly", "quarter": "Q1",
                      "year": 2026, "parent_id": annual_id, "org_unit_id": team_id}, dhtok)
        return s, g

    def test_dept_head_assigns_quarterly_plan_to_team(self, client):
        dhtok = login(client, "depthead1")
        annual_id = self._annual(client, login(client, "exec1"))

        s, g = self._dept_quarterly_for_team(client, dhtok, annual_id, 20)
        assert s == 201

        s, detail = jget(client, f"/api/strategic-goals/{g['id']}", dhtok)
        assert s == 200
        assert detail["org_unit_id"] == 20
        assert detail["assigned_name"] == "TL A"  # team 20's leader

        s, dept = jget(client, "/api/strategic-goals/department", dhtok)
        assert s == 200
        team_a = next(t for t in dept["teams"] if t["unit_id"] == 20)
        assert team_a["quarterly_plans"][0]["id"] == g["id"]

    def test_dept_quarterly_requires_annual_parent(self, client):
        etok = login(client, "exec1")
        annual_id = self._annual(client, etok)
        dtok = login(client, "director1")
        s, quarterly = jpost(client, "/api/strategic-goals",
                             {"title": "Directorate Q1", "scope": "quarterly",
                              "quarter": "Q1", "year": 2026, "parent_id": annual_id}, dtok)
        assert s == 201

        dhtok = login(client, "depthead1")
        s, d = jpost(client, "/api/strategic-goals",
                     {"title": "Nested", "scope": "quarterly", "parent_id": quarterly["id"],
                      "org_unit_id": 20}, dhtok)
        assert s == 400

    def test_dept_quarterly_restricted_to_own_teams(self, client):
        dhtok = login(client, "depthead1")
        annual_id = self._annual(client, login(client, "exec1"))
        # team 22 belongs to the finance dept, not this department head
        s, d = self._dept_quarterly_for_team(client, dhtok, annual_id, 22)
        assert s == 403

    def test_dept_quarterly_org_unit_must_be_team(self, client):
        dhtok = login(client, "depthead1")
        annual_id = self._annual(client, login(client, "exec1"))
        s, d = jpost(client, "/api/strategic-goals",
                     {"title": "Bad unit", "scope": "quarterly", "parent_id": annual_id,
                      "org_unit_id": 10}, dhtok)  # the department itself, not a team
        assert s == 400

    def test_leader_synthesizes_quarterly_into_member_tasks(self, client):
        etok = login(client, "exec1")
        annual_id = self._annual(client, etok)
        dhtok = login(client, "depthead1")
        s, quarter = self._dept_quarterly_for_team(client, dhtok, annual_id, 20)
        qid = quarter["id"]

        ltok = login(client, "lead1")
        s, d = jpost(client, f"/api/strategic-goals/{qid}/assign",
                     {"assignments": [
                         {"title": "Deliver site report", "assigned_to_id": 34,
                          "kpis": [{"name": "Deliverable", "kpi_type": "numeric",
                                    "target_value": 1}]},
                     ]}, ltok)
        assert s == 200
        assert d["child_scope"] == "individual"

        s, team = jget(client, "/api/strategic-goals/team", ltok)
        assert s == 200
        assert any(q["id"] == qid for q in team["quarterly_plans"])
        member = next(m for m in team["members"] if m["id"] == 34)
        assert member["tasks"][0]["title"] == "Deliver site report"

    def test_other_leader_cannot_synthesize_foreign_quarterly(self, client):
        etok = login(client, "exec1")
        annual_id = self._annual(client, etok)
        dhtok = login(client, "depthead1")
        s, quarter = self._dept_quarterly_for_team(client, dhtok, annual_id, 20)

        ltok = login(client, "lead2")  # heads team 21, not team 20
        s, d = jpost(client, f"/api/strategic-goals/{quarter['id']}/assign",
                     {"assignments": [
                         {"title": "Sneaky", "assigned_to_id": 36,
                          "kpis": [{"name": "X", "kpi_type": "numeric", "target_value": 1}]},
                     ]}, ltok)
        assert s == 403


class TestActivityGoalAssessment:
    """Program activities are assessed against the plan & goal: the chain runs
    member tasks -> activities -> dept plans -> programs, so a goal's linked
    activities (recursively rolled up) drive its progress; weekly-task
    execution only measures goals without linked activities."""

    def _goal_chain(self, client):
        """Annual -> dept-head quarterly(team 20) -> individual task for 34.
        Returns (tokens, ids)."""
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
                         {"title": "ESIA review", "assigned_to_id": 34,
                          "kpis": [{"name": "Pages", "kpi_type": "numeric",
                                    "target_value": 100, "unit": "pages"}]},
                     ]}, ltok)
        assert s == 200
        return {
            "annual_id": annual["id"], "quarterly_id": quarter["id"],
            "task_id": d["created"][0], "etok": etok, "ltok": ltok, "dhtok": dhtok,
        }

    def _program(self, client, etok, name="Regulatory Program"):
        s, p = jpost(client, "/api/programs", {"name": name, "cycle_id": 1}, etok)
        assert s == 201
        return p["id"]

    def _team_activity(self, client, dhtok, pid, title="Team field inspection"):
        s, a = jpost(client, f"/api/programs/{pid}/activities",
                     {"title": title, "org_unit_id": 20}, dhtok)
        assert s == 201
        return a["id"]

    def _activity(self, client, dhtok, ltok, pid, assignee, goal_id):
        parent = self._team_activity(client, dhtok, pid)
        s, a = jpost(client, f"/api/programs/{pid}/activities",
                     {"title": "Review permit X", "parent_id": parent,
                      "assignee_id": assignee, "strategic_goal_id": goal_id}, ltok)
        assert s == 201
        return a["id"]

    def test_activity_serves_members_individual_task(self, client):
        chain = self._goal_chain(client)
        pid = self._program(client, chain["etok"])
        aid = self._activity(client, chain["dhtok"], chain["ltok"], pid, 34, chain["task_id"])

        s, prog = jget(client, f"/api/programs/{pid}", chain["ltok"])
        assert s == 200
        root = prog["activities"][0]
        assert root["org_unit_name"] == "ESIA Team A"
        assert root["org_unit_id"] == 20
        activity = root["children"][0]
        assert activity["strategic_goal_id"] == chain["task_id"]
        assert activity["strategic_goal_title"] == "ESIA review"

    def test_activity_cannot_serve_another_members_task(self, client):
        chain = self._goal_chain(client)
        pid = self._program(client, chain["etok"])
        # individual task belongs to emp 35, activity is assigned to emp 34
        s, other = jpost(client, f"/api/strategic-goals/{chain['quarterly_id']}/assign",
                         {"assignments": [
                             {"title": "Other member", "assigned_to_id": 35,
                              "kpis": [{"name": "Pages", "kpi_type": "numeric",
                                        "target_value": 10}]},
                         ]}, chain["ltok"])
        assert s == 200

        parent = self._team_activity(client, chain["dhtok"], pid)
        s, d = jpost(client, f"/api/programs/{pid}/activities",
                     {"title": "Wrong owner", "parent_id": parent,
                      "assignee_id": 34,
                      "strategic_goal_id": other["created"][0]}, chain["ltok"])
        assert s == 400

    def test_activity_cannot_serve_cancelled_goal(self, client):
        chain = self._goal_chain(client)
        pid = self._program(client, chain["etok"])
        parent = self._team_activity(client, chain["dhtok"], pid)
        s, _ = jput(client, f"/api/strategic-goals/{chain['task_id']}",
                    {"status": "cancelled"}, chain["ltok"])
        s, d = jpost(client, f"/api/programs/{pid}/activities",
                     {"title": "Cancelled", "parent_id": parent,
                      "assignee_id": 34,
                      "strategic_goal_id": chain["task_id"]}, chain["ltok"])
        assert s == 400

    def test_assignable_goals_scoped_to_assignee(self, client):
        chain = self._goal_chain(client)
        pid = self._program(client, chain["etok"])
        s, other = jpost(client, f"/api/strategic-goals/{chain['quarterly_id']}/assign",
                         {"assignments": [
                             {"title": "Member 35 task", "assigned_to_id": 35,
                              "kpis": [{"name": "Pages", "kpi_type": "numeric",
                                        "target_value": 10}]},
                         ]}, chain["ltok"])
        other_id = other["created"][0]

        s, options = jget(client, f"/api/programs/{pid}/assignable-goals?assignee_id=34",
                          chain["ltok"])
        assert s == 200
        ids = {o["id"] for o in options}
        assert chain["task_id"] in ids
        assert other_id not in ids

    def test_goal_progress_is_driven_by_linked_activity_kpis(self, client):
        chain = self._goal_chain(client)
        pid = self._program(client, chain["etok"])
        aid = self._activity(client, chain["dhtok"], chain["ltok"], pid, 34, chain["task_id"])
        gid = chain["task_id"]

        # Activity KPI: recorded fully => activity achievement 100.
        s, kpi = jpost(client, f"/api/programs/activities/{aid}/kpis",
                       {"name": "Compliance", "kpi_type": "numeric",
                        "target_value": 100, "actual_value": 100}, chain["ltok"])
        assert s == 201

        # Weekly execution: 1 of 2 tasks done => 50%. Activities are
        # authoritative: they must NOT dilute the measured achievement.
        s, _ = jpost(client, "/api/weekly-plans/34/current", {"tasks": [
            {"title": "Draft", "status": "done", "strategic_goal_id": gid},
            {"title": "Submit", "status": "todo", "strategic_goal_id": gid},
        ]}, chain["ltok"])
        assert s == 200

        # Activity-driven => 100 (not blended 75).
        s, detail = jget(client, f"/api/strategic-goals/{gid}", chain["ltok"])
        assert detail["progress_pct"] == 100
        assert [c["id"] for c in detail["activity_contributions"]] == [aid]

        # Rollup reaches the grand plan.
        s, plan = jget(client, "/api/tiers/grand-plan", chain["etok"])
        annual = next(g for g in plan["goals"] if g["id"] == chain["annual_id"])
        assert annual["progress_pct"] == 100

    def test_goal_progress_falls_back_to_weekly_when_unmeasured(self, client):
        chain = self._goal_chain(client)
        gid = chain["task_id"]

        # No linked activities with KPIs -> weekly done-rate measures the goal.
        s, _ = jpost(client, "/api/weekly-plans/34/current", {"tasks": [
            {"title": "Draft", "status": "done", "strategic_goal_id": gid},
            {"title": "Submit", "status": "todo", "strategic_goal_id": gid},
        ]}, chain["ltok"])
        assert s == 200

        s, detail = jget(client, f"/api/strategic-goals/{gid}", chain["ltok"])
        assert detail["progress_pct"] == 50

    def test_activity_link_can_be_removed_via_update(self, client):
        chain = self._goal_chain(client)
        pid = self._program(client, chain["etok"])
        aid = self._activity(client, chain["dhtok"], chain["ltok"], pid, 34, chain["task_id"])

        s, d = jput(client, f"/api/programs/activities/{aid}",
                    {"strategic_goal_id": None}, chain["ltok"])
        assert s == 200
        s, prog = jget(client, f"/api/programs/{pid}", chain["ltok"])
        assert prog["activities"][0]["strategic_goal_id"] is None
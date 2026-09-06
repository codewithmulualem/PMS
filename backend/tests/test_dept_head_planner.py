"""Dept-head planner: authors department plans, manages program activities,
and authors/reviews the weekly execution of their team leads."""

import pytest
from conftest import login, jget, jpost, jput, jdel
from test_plan_performance import _build_tier_tree
from test_program_crud import create_program, team_activity


@pytest.fixture(autouse=True)
def _tier_setup(client):
    _build_tier_tree(client)
    yield


def _annual(client):
    etok = login(client, "exec1")
    s, d = jpost(client, "/api/strategic-goals",
                 {"title": "Grand plan", "scope": "annual", "year": 2026}, etok)
    assert s == 201
    return d["id"]


def _dept_quarterly(client, dhtok, annual_id, team=20, title="Team A quarterly"):
    s, d = jpost(client, "/api/strategic-goals",
                 {"title": title, "scope": "quarterly", "quarter": "Q1", "year": 2026,
                  "parent_id": annual_id, "org_unit_id": team}, dhtok)
    assert s == 201, f"dept quarterly failed: {s} {d}"
    return d["id"]


class TestDeptHeadAuthorsPlans:
    def test_dept_head_authors_quarterly_for_own_team(self, client):
        annual_id = _annual(client)
        dhtok = login(client, "depthead1")
        s, d = jpost(client, "/api/strategic-goals",
                     {"title": "Backlog clearance", "scope": "quarterly",
                      "quarter": "Q1", "year": 2026, "parent_id": annual_id,
                      "org_unit_id": 20}, dhtok)
        assert s == 201

    def test_dept_head_cannot_author_quarterly_outside_department(self, client):
        annual_id = _annual(client)
        dhtok = login(client, "depthead1")
        s, d = jpost(client, "/api/strategic-goals",
                     {"title": "Not mine", "scope": "quarterly", "quarter": "Q1",
                      "year": 2026, "parent_id": annual_id, "org_unit_id": 22}, dhtok)
        assert s == 403  # team 22 hangs under d11, outside d10

    def test_department_planner_surfaces_annuals_and_goal_metadata(self, client):
        annual_id = _annual(client)
        dhtok = login(client, "depthead1")
        qid = _dept_quarterly(client, dhtok, annual_id, 20)
        # Synthesize a work plan under the authored quarterly.
        s, d = jpost(client, f"/api/strategic-goals/{qid}/assign",
                     {"assignments": [{"title": "ESIA work plan", "org_unit_id": 20,
                                       "description": "Clear the backlog"}]}, dhtok)
        assert s == 200

        s, data = jget(client, "/api/strategic-goals/department", dhtok)
        assert s == 200
        assert any(a["id"] == annual_id for a in data["annuals"])
        team_a = next(t for t in data["teams"] if t["unit_id"] == 20)
        assert any(q["id"] == qid and q["owner_id"] == 31 for q in team_a["quarterly_plans"])
        assert team_a["plans"][0]["scope"] == "team"
        assert team_a["plans"][0]["owner_id"] == 31
        assert team_a["plans"][0]["description"] is not None

    def test_department_planner_activity_shape_has_management_fields(self, client):
        dhtok = login(client, "depthead1")
        pid = create_program(client)
        tid = team_activity(client, dhtok, pid, "Inspection sweep",
                            team=20, description="Quarterly field checks",
                            due_date="2026-12-31")

        s, data = jget(client, "/api/strategic-goals/department", dhtok)
        assert s == 200
        team_a = next(t for t in data["teams"] if t["unit_id"] == 20)
        act = next(a for a in team_a["activities"] if a["id"] == tid)
        assert act["org_unit_id"] == 20
        assert act["description"] == "Quarterly field checks"
        assert act["parent_id"] is None
        assert act["due_date"] == "2026-12-31"


class TestGoalDeletion:
    def test_dept_head_cannot_delete_director_goal(self, client):
        annual_id = _annual(client)
        dtok = login(client, "director1")
        s, q = jpost(client, "/api/strategic-goals",
                     {"title": "Directorate Q1", "scope": "quarterly",
                      "quarter": "Q1", "year": 2026, "parent_id": annual_id}, dtok)
        assert s == 201

        dhtok = login(client, "depthead1")
        s, d = jdel(client, f"/api/strategic-goals/{q['id']}", dhtok)
        assert s == 403

    def test_dept_head_deletes_own_childless_quarterly(self, client):
        annual_id = _annual(client)
        dhtok = login(client, "depthead1")
        qid = _dept_quarterly(client, dhtok, annual_id, 20)
        s, d = jdel(client, f"/api/strategic-goals/{qid}", dhtok)
        assert s == 200
        s, d = jget(client, f"/api/strategic-goals/{qid}", dhtok)
        assert s == 404

    def test_goal_with_children_cannot_be_deleted(self, client):
        annual_id = _annual(client)
        dhtok = login(client, "depthead1")
        qid = _dept_quarterly(client, dhtok, annual_id, 20)
        s, d = jpost(client, f"/api/strategic-goals/{qid}/assign",
                     {"assignments": [{"title": "Work plan", "org_unit_id": 20}]}, dhtok)
        assert s == 200
        s, d = jdel(client, f"/api/strategic-goals/{qid}", dhtok)
        assert s == 400


class TestWeeklyOversight:
    def test_dept_head_authors_leader_week(self, client):
        dhtok = login(client, "depthead1")
        s, d = jpost(client, "/api/weekly-plans/33/current",
                     {"tasks": [{"title": "Run inspection", "day_of_week": 1},
                                {"title": "Follow-up", "status": "done"}]}, dhtok)
        assert s == 200, f"{s} {d}"

        s, data = jget(client, "/api/weekly-plans/plan-performance", dhtok)
        assert s == 200
        lead_b = next(x for x in data["summaries"] if x["employee_id"] == 33)
        assert lead_b["total_tasks"] == 2
        assert lead_b["done_tasks"] == 1
        assert any(t["status"] == "done" for t in lead_b["tasks"])

    def test_dept_head_cannot_author_outside_scope(self, client):
        dhtok = login(client, "depthead1")
        s, d = jpost(client, "/api/weekly-plans/30/current",
                     {"tasks": [{"title": "Nope"}]}, dhtok)
        assert s == 403  # director 30 is up-tree, outside d10

    def test_goal_link_must_belong_to_member(self, client):
        # lead2 authors an individual goal for member 36 (team 21).
        annual_id = _annual(client)
        dhtok = login(client, "depthead1")
        qid = _dept_quarterly(client, dhtok, annual_id, 21, "Team B quarterly")
        ltok = login(client, "lead2")
        s, d = jpost(client, "/api/strategic-goals",
                     {"title": "Member 36 task", "scope": "individual",
                      "parent_id": qid, "assigned_to_id": 36,
                      "kpis": [{"name": "deliverables", "target_value": 5}]}, ltok)
        assert s == 201
        individual_id = d["id"]

        # Dept head authoring MEMBER 34's week may not link another's goal.
        s, d = jpost(client, "/api/weekly-plans/34/current",
                     {"tasks": [{"title": "Chore", "strategic_goal_id": individual_id}]}, dhtok)
        assert s == 400

        # But may link member 36's own goal when authoring HER week.
        s, d = jpost(client, "/api/weekly-plans/36/current",
                     {"tasks": [{"title": "Deliver", "strategic_goal_id": individual_id}]}, dhtok)
        assert s == 200


class TestPlanLinkedActivities:
    """Activities link to the department plan, not the program: dept heads and
    team leaders author them via /strategic-goals/<id>/activities. The program
    id is inherited (or NULL), and progress rolls member tasks up to plans."""

    def test_dept_head_creates_plan_activity_without_program(self, client):
        annual_id = _annual(client)
        dhtok = login(client, "depthead1")
        qid = _dept_quarterly(client, dhtok, annual_id, 20)

        s, d = jpost(client, f"/api/strategic-goals/{qid}/activities",
                     {"title": "Inspection sweep", "org_unit_id": 20,
                      "description": "Quarterly field checks"}, dhtok)
        assert s == 201, f"{s} {d}"
        aid = d["id"]

        s, data = jget(client, "/api/strategic-goals/department", dhtok)
        assert s == 200
        team_a = next(t for t in data["teams"] if t["unit_id"] == 20)
        act = next(a for a in team_a["activities"] if a["id"] == aid)
        assert act["strategic_goal_id"] == qid
        assert act["program_id"] is None  # no program picked at dept level
        assert act["org_unit_id"] == 20
        assert act["description"] == "Quarterly field checks"

    def test_plan_activity_inherits_program_from_plan_chain(self, client):
        pid = create_program(client)
        etok = login(client, "exec1")
        s, d = jpost(client, "/api/strategic-goals",
                     {"title": "Coined annual", "scope": "annual", "year": 2026,
                      "program_id": pid}, etok)
        assert s == 201
        annual_id = d["id"]
        dhtok = login(client, "depthead1")
        qid = _dept_quarterly(client, dhtok, annual_id, 20)

        s, d = jpost(client, f"/api/strategic-goals/{qid}/activities",
                     {"title": "Field sweep", "org_unit_id": 20}, dhtok)
        assert s == 201
        s, data = jget(client, "/api/strategic-goals/department", dhtok)
        team_a = next(t for t in data["teams"] if t["unit_id"] == 20)
        act = next(a for a in team_a["activities"] if a["id"] == d["id"])
        assert act["program_id"] == pid  # inherited through the plan chain

    def test_dept_head_cannot_add_activity_to_grand_annual(self, client):
        annual_id = _annual(client)
        dhtok = login(client, "depthead1")
        s, d = jpost(client, f"/api/strategic-goals/{annual_id}/activities",
                     {"title": "Nope", "org_unit_id": 20}, dhtok)
        assert s == 403  # the annual is exec-owned, not a dept-level plan

    def test_cannot_assign_activity_to_team_outside_department(self, client):
        annual_id = _annual(client)
        dhtok = login(client, "depthead1")
        qid = _dept_quarterly(client, dhtok, annual_id, 20)
        s, d = jpost(client, f"/api/strategic-goals/{qid}/activities",
                     {"title": "Wrong team", "org_unit_id": 22}, dhtok)
        assert s == 403  # team 22 hangs under d11, outside d10

    def test_only_departments_and_leaders_author_plan_activities(self, client):
        annual_id = _annual(client)
        dhtok = login(client, "depthead1")
        qid = _dept_quarterly(client, dhtok, annual_id, 20)
        # Executives author programs, not activities.
        etok = login(client, "exec1")
        s, d = jpost(client, f"/api/strategic-goals/{qid}/activities",
                     {"title": "Nope", "org_unit_id": 20}, etok)
        assert s == 403
        # Team members can't either.
        mtok = login(client, "emp20")
        s, d = jpost(client, f"/api/strategic-goals/{qid}/activities",
                     {"title": "Nope", "org_unit_id": 20}, mtok)
        assert s == 403

    def test_team_leader_drills_down_plan_activity(self, client):
        annual_id = _annual(client)
        dhtok = login(client, "depthead1")
        qid = _dept_quarterly(client, dhtok, annual_id, 20)
        s, d = jpost(client, f"/api/strategic-goals/{qid}/activities",
                     {"title": "Field sweep", "org_unit_id": 20}, dhtok)
        aid = d["id"]

        ltok = login(client, "lead1")
        # Drill-down must name a parent from the leader's own team.
        s, d = jpost(client, f"/api/strategic-goals/{qid}/activities",
                     {"title": "Sub task", "parent_id": aid, "assignee_id": 34}, ltok)
        assert s == 201
        # A leader may not drill into another team's activity.
        stok = login(client, "lead2")
        s, d = jpost(client, f"/api/strategic-goals/{qid}/activities",
                     {"title": "Not mine", "parent_id": aid, "assignee_id": 36}, stok)
        assert s == 403
        # Drill-down without a parent is rejected.
        s, d = jpost(client, f"/api/strategic-goals/{qid}/activities",
                     {"title": "Float", "assignee_id": 34}, ltok)
        assert s == 403

    def test_plan_progress_rolls_member_tasks_up_to_plan(self, client):
        annual_id = _annual(client)
        dhtok = login(client, "depthead1")
        qid = _dept_quarterly(client, dhtok, annual_id, 20, "ESIA clearance")
        s, d = jpost(client, f"/api/strategic-goals/{qid}/activities",
                     {"title": "Field sweep", "org_unit_id": 20}, dhtok)
        aid = d["id"]

        ltok = login(client, "lead1")
        s, d = jpost(client, f"/api/strategic-goals/{qid}/activities",
                     {"title": "Task A", "parent_id": aid, "assignee_id": 34,
                      "kpis": [{"name": "checks", "kpi_type": "numeric",
                                "target_value": 10, "actual_value": 10}]}, ltok)
        assert s == 201, f"{s} {d}"
        s, d = jpost(client, f"/api/strategic-goals/{qid}/activities",
                     {"title": "Task B", "parent_id": aid, "assignee_id": 35,
                      "kpis": [{"name": "checks", "kpi_type": "numeric",
                                "target_value": 10, "actual_value": 5}]}, ltok)
        assert s == 201

        s, data = jget(client, "/api/strategic-goals/department", dhtok)
        assert s == 200
        team_a = next(t for t in data["teams"] if t["unit_id"] == 20)
        act = next(a for a in team_a["activities"] if a["id"] == aid)
        assert act["progress_pct"] == 75  # (100 + 50) / 2 across the two tasks
        assert act["member_task_count"] == 2
        assert act["program_id"] is None

        qrow = next(q for q in team_a["quarterly_plans"] if q["id"] == qid)
        assert qrow["progress_pct"] == 75  # driven by the linked activity

        # The grand annual rolls the activity-driven quarter up.
        etok = login(client, "exec1")
        s, plan = jget(client, "/api/tiers/grand-plan", etok)
        annual = next(g for g in plan["goals"] if g["id"] == annual_id)
        assert annual["progress_pct"] == 75
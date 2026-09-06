"""Org-unit roll-up overview endpoints.

   /api/tiers/overview   - nested completion + performance roll-up per tier scope
   /api/tiers/grand-plan - executive roll-up of strategic goals + completion
"""

import pytest

from conftest import login, jget, jpost
from test_plan_performance import _build_tier_tree


@pytest.fixture(autouse=True)
def _tier_setup(client):
    _build_tier_tree(client)
    yield


def _walk(tree):
    """Yield a node and every descendant."""
    yield tree
    for child in tree.get("children", []):
        yield from _walk(child)


class TestTierOverview:
    def test_team_leader_overview_is_scoped_to_team(self, client):
        tok = login(client, "lead1")  # team A (d20): lead 32 + members 34,35
        s, d = jget(client, "/api/tiers/overview", tok)
        assert s == 200
        assert d["tier"] == "team_leader"
        root = d["tree"]
        members = {m["employee_id"] for m in root["members"]}
        assert {32, 34, 35} <= members
        assert 36 not in members  # other team's member excluded
        assert len(list(_walk(root))) == 1  # flat: just the team

    def test_director_overview_rolls_up_subtree(self, client):
        # give member 34 one done task
        etok = login(client, "emp20")
        jpost(client, "/api/weekly-plans/current",
              {"tasks": [{"title": "T1", "status": "done", "day_of_week": 1}]}, etok)

        tok = login(client, "director1")  # d1 directorate
        s, d = jget(client, "/api/tiers/overview", tok)
        assert s == 200
        assert d["tier"] == "director"
        tree = d["tree"]
        assert tree["name"] == "Environmental Regulatory"
        assert tree["total_tasks"] == 1
        assert tree["done_tasks"] == 1
        assert tree["completion_pct"] == 100
        # contains teams as descendants
        child_names = [n["name"] for n in _walk(tree)]
        assert any("Team A" in n for n in child_names)
        assert any("Team B" in n for n in child_names)

    def test_director_cannot_see_other_directorate(self, client):
        tok = login(client, "director1")
        s, d = jget(client, "/api/tiers/overview", tok)
        assert s == 200
        names = [n["name"] for n in _walk(d["tree"])]
        assert not any("Finance" in n or "Corporate" in n for n in names)

    def test_dept_head_overview_scoped_to_department(self, client):
        tok = login(client, "depthead1")  # d10 ESIA dept
        s, d = jget(client, "/api/tiers/overview", tok)
        assert s == 200
        assert d["tier"] == "dept_head"
        names = [n["name"] for n in _walk(d["tree"])]
        assert "ESIA Dept" in names
        assert not any("Finance" in n for n in names)

    def test_employee_blocked(self, client):
        tok = login(client, "employee1")
        s, d = jget(client, "/api/tiers/overview", tok)
        assert s == 403


class TestGrandPlan:
    def test_executive_grand_plan_returns_org_rollup(self, client):
        tok = login(client, "exec1")
        s, d = jget(client, "/api/tiers/grand-plan", tok)
        assert s == 200
        assert d["tree"]
        assert "goals" in d
        assert "completion_pct" in d["tree"]

    def test_grand_plan_excludes_nonexecutives(self, client):
        tok = login(client, "director1")
        s, d = jget(client, "/api/tiers/grand-plan", tok)
        assert s == 403

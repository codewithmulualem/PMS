"""Evaluation scope: employees + team leaders get individual scored reviews.

Department heads, directors and executives are NOT individual-evaluation
subjects. A department head may instead be auto-scored by a director from the
department's plan task-completion. Dept heads can batch-approve every pending
member/team-leader review in their subtree. Tier roll-ups expose avg_eval_score
(derived from evaluations) distinct from completion_pct (plan tasks).
"""

import pytest

from conftest import login, jget, jpost, _test_db
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


def _form(client, token):
    """Create an evaluation form with one self-perspective rating question."""
    s, d = jpost(client, "/api/evaluation-forms", {
        "name": "Annual Review",
        "approval_levels": 2,
        "weight_self": 1,
        "weight_manager": 1,
        "weight_peer": 0,
    }, token)
    assert s in (200, 201), d
    form_id = d["id"]
    s, d = jpost(client, f"/api/evaluation-forms/{form_id}/sections",
                 {"title": "Self", "perspective": "self", "order_index": 1, "weight": 1}, token)
    assert s in (200, 201), d
    sec_id = d["id"]
    s, q = jpost(client, f"/api/evaluation-form-sections/{sec_id}/questions",
                 {"text": "Rate your work", "kind": "rating", "max_score": 5, "order_index": 1}, token)
    assert s in (200, 201), q
    return form_id


def _assign(client, token, form_id, employee_ids):
    return jpost(client, f"/api/evaluation-forms/{form_id}/assign",
                 {"cycle_id": 1, "due_date": "2026-09-30",
                  "assignments": [{"employee_id": e, "with_manager": False, "peer_ids": []}
                                  for e in employee_ids]}, token)


def _assignment_ids_by_subject(client, token):
    """Map employee_id -> self-assignment id from the admin list endpoint."""
    s, d = jget(client, "/api/evaluation-assignments", token)
    assert s == 200, d
    return {a["employee_id"]: a["id"] for a in d}


class TestSubjectScope:
    def test_assign_allows_employee_and_team_leader(self, client):
        atok = login(client, "admin1")
        fid = _form(client, atok)
        s, d = _assign(client, atok, fid, [32, 34])  # team lead + member
        assert s == 200, d
        assert len(d["created"]) == 2
        assert d["blocked"] == []

    def test_assign_blocks_dept_head_director_executive(self, client):
        atok = login(client, "admin1")
        fid = _form(client, atok)
        # 31 = dept head, 30 = director, 2 = apex in the d2 directorate
        s, d = _assign(client, atok, fid, [31, 30, 2, 34])
        assert s == 200, d
        assert len(d["created"]) == 1          # only the member passes
        assert len(d["blocked"]) == 3
        assert {b["tier"] for b in d["blocked"]} == {"dept_head", "director"}


class TestDeptAutoScore:
    def test_director_auto_scores_dept_head_only(self, client):
        # A task in the dept subtree so completion > 0
        etok = login(client, "emp20")
        jpost(client, "/api/weekly-plans/current",
              {"tasks": [{"title": "T1", "status": "done", "day_of_week": 1}]}, etok)

        tok = login(client, "director1")
        s, d = jpost(client, "/api/evaluations/dept-auto-score",
                     {"dept_head_id": 31, "cycle_id": 1}, tok)
        assert s == 200, d
        assert d["status"] == "scored"
        assert d["source"] == "department_plan"
        assert d["full_name"] == "DH ESIA"
        assert 0 <= d["score"] <= 100

    def test_auto_score_rejects_non_dept_head(self, client):
        tok = login(client, "director1")
        s, d = jpost(client, "/api/evaluations/dept-auto-score",
                     {"dept_head_id": 34, "cycle_id": 1}, tok)  # member, not dept head
        assert s == 400

    def test_auto_score_requires_director(self, client):
        tok = login(client, "emp20")
        s, d = jpost(client, "/api/evaluations/dept-auto-score",
                     {"dept_head_id": 31, "cycle_id": 1}, tok)
        assert s == 403

    def test_auto_score_reused_for_same_dept_cycle(self, client):
        tok = login(client, "director1")
        s1, d1 = jpost(client, "/api/evaluations/dept-auto-score",
                       {"dept_head_id": 31, "cycle_id": 1}, tok)
        s2, d2 = jpost(client, "/api/evaluations/dept-auto-score",
                       {"dept_head_id": 31, "cycle_id": 1}, tok)
        assert s1 == s2 == 200
        assert d1["id"] == d2["id"]  # same assignment refreshed, not duplicated

    def test_auto_assignment_viewable_as_director(self, client):
        tok = login(client, "director1")
        s, d = jpost(client, "/api/evaluations/dept-auto-score",
                     {"dept_head_id": 31, "cycle_id": 1}, tok)
        assert s == 200
        s, detail = jget(client, f"/api/evaluations/{d['id']}", tok)
        assert s == 200, detail
        assert detail["auto_score_source"] == "department_plan"
        assert detail["score"] == d["score"]
        assert detail["status"] == "scored"


class TestDeptBatchApproval:
    def _scored_and_pending(self, client):
        """Assign reviews to member 34 and team lead 32; submit both so they
        pend at level 1. Returns the employee->assignment-id map."""
        atok = login(client, "admin1")
        fid = _form(client, atok)
        s, d = _assign(client, atok, fid, [32, 34])
        assert s == 200, d
        return _assignment_ids_by_subject(client, atok)

    def test_dept_head_batch_approves_all_in_subtree(self, client):
        ids = self._scored_and_pending(client)

        etok = login(client, "emp20")   # member 34 submits
        jpost(client, f"/api/evaluations/{ids[34]}/answers",
              {"action": "submit", "answers": []}, etok)
        ltok = login(client, "lead1")   # team lead 32 submits
        s, r = jpost(client, f"/api/evaluations/{ids[32]}/answers",
                     {"action": "submit", "answers": []}, ltok)
        assert s == 200 and r["status"] == "submitted", r

        tok = login(client, "depthead1")
        s, d = jpost(client, "/api/evaluations/batch-decision",
                     {"decision": "approve", "comments": "approved in batch"}, tok)
        assert s == 200, d
        # Lead's own review is pending at level 1 for the dept head.
        assert d["approved"] == 1

    def test_batch_requires_comments(self, client):
        self._scored_and_pending(client)
        tok = login(client, "depthead1")
        s, d = jpost(client, "/api/evaluations/batch-decision",
                     {"decision": "approve", "comments": ""}, tok)
        assert s == 400


class TestEvalScoreInRollup:
    def test_avg_eval_score_present_and_distinct_from_completion(self, client):
        tok = login(client, "director1")
        s, d = jget(client, "/api/tiers/overview", tok)
        assert s == 200
        for node in _walk(d["tree"]):
            assert "avg_eval_score" in node
            assert "completion_pct" in node
            assert "eval_count" in node

    def test_member_eval_score_after_finalized_review(self, client):
        """Fully approve a member review end-to-end; its eval score then appears
        on the roll-up, while task completion stays independent."""
        atok = login(client, "admin1")
        fid = _form(client, atok)
        _assign(client, atok, fid, [34])
        ids = _assignment_ids_by_subject(client, atok)
        aid = ids[34]

        etok = login(client, "emp20")
        s, detail = jget(client, f"/api/evaluations/{aid}", etok)
        assert s == 200, detail
        qid = detail["form"]["sections"][0]["questions"][0]["id"]
        jpost(client, f"/api/evaluations/{aid}/answers",
              {"action": "submit", "answers": [{"question_id": qid, "rating_value": 5}]}, etok)

        ltok = login(client, "lead1")
        s, r = jpost(client, f"/api/evaluations/{aid}/decision",
                     {"decision": "approve", "comments": "ok"}, ltok)
        assert r["status"] in ("in_review", "scored"), r

        dtok = login(client, "depthead1")
        s, r = jpost(client, f"/api/evaluations/{aid}/decision",
                     {"decision": "approve", "comments": "final"}, dtok)
        assert s == 200 and r["status"] == "scored", r

        tok = login(client, "depthead1")
        s, d = jget(client, "/api/tiers/overview", tok)
        assert s == 200
        members = {m["employee_id"]: m for n in _walk(d["tree"]) for m in n["members"]}
        assert members[34]["eval_score"] == 100.0
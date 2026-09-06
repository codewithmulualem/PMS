"""Tier-scoped plan performance: director / dept_head / team_leader views."""

import sqlite3
import os
import pytest

from conftest import login, jget, jpost, _test_db
from auth import hash_password


def _build_tier_tree(client):
    """Add a proper org tree + tier accounts on top of the minimal fixture.

    org_unit_types: 1=Authority(0), 2=Directorate(1), 3=Department(2), 4=Team(3)

    Tree:
      d1 Env Regulatory (directorate)
        d10 ESIA Dept (department)
          d20 ESIA Team A (team)
          d21 ESIA Team B (team)
      d2 Corporate Services (directorate)
        d11 Finance Dept (department)
          d22 Finance Team (team)
    """
    conn = sqlite3.connect(_test_db)
    conn.row_factory = sqlite3.Row
    pwd = hash_password("password123")
    try:
        conn.executescript("""
            INSERT INTO org_unit_types (id, name, level_order)
            VALUES (1,'Authority',0),(2,'Directorate',1),(3,'Department',2),(4,'Team',3);

            UPDATE departments SET unit_type_id=2, parent_id=NULL WHERE id IN (1,2);
            INSERT INTO departments (id, name, parent_id, unit_type_id)
            VALUES (10,'ESIA Dept',1,3),(11,'Finance Dept',2,3);
            INSERT INTO departments (id, name, parent_id, unit_type_id)
            VALUES (20,'ESIA Team A',10,4),(21,'ESIA Team B',10,4),(22,'Finance Team',11,4);

            INSERT INTO roles (id, name, system_default)
            VALUES (5,'director',0),(6,'dept_head',0),(7,'team_leader',0);

            -- unit-head positions (is_head) so chain resolution and the
            -- dept-head auto-score mirror the production org model
            INSERT INTO positions (id, title, org_unit_id, is_head, active)
            VALUES (100,'Director',1,1,1),
                   (101,'Dept Head',10,1,1),
                   (102,'Team Lead',20,1,1),
                   (103,'Team Lead',21,1,1);

            -- director (emp 30) heads directorate d1
            INSERT INTO employees (id, full_name, email, position, position_id, department_id, manager_id, employment_status)
            VALUES (30,'Dir Env','dir@test.com','Director',100,1,2,'active');
            -- dept head (emp 31) heads d10
            INSERT INTO employees (id, full_name, email, position, position_id, department_id, manager_id, employment_status)
            VALUES (31,'DH ESIA','dh@test.com','Dept Head',101,10,30,'active');
            -- team leads (emp 32 -> d20, emp 33 -> d21)
            INSERT INTO employees (id, full_name, email, position, position_id, department_id, manager_id, employment_status)
            VALUES (32,'TL A','tlA@test.com','Team Lead',102,20,31,'active'),
                   (33,'TL B','tlB@test.com','Team Lead',103,21,31,'active');
            -- team members
            INSERT INTO employees (id, full_name, email, position, position_id, department_id, manager_id, employment_status)
            VALUES (34,'Member A1','m1@test.com','Analyst',NULL,20,32,'active'),
                   (35,'Member A2','m2@test.com','Analyst',NULL,20,32,'active'),
                   (36,'Member B1','m3@test.com','Analyst',NULL,21,33,'active');
        """)
        users = [
            (30, 'director1', 'director', 5),
            (31, 'depthead1', 'dept_head', 6),
            (32, 'lead1', 'team_leader', 7),
            (33, 'lead2', 'team_leader', 7),
            (34, 'emp20', 'employee', 4),
            (35, 'emp21', 'employee', 4),
            (36, 'emp22', 'employee', 4),
        ]
        for emp_id, username, role, role_id in users:
            conn.execute(
                "INSERT INTO users (username, password_hash, role, role_id, employee_id) "
                "VALUES (?,?,?,?,?)",
                (username, pwd, role, role_id, emp_id))
        conn.commit()
    finally:
        conn.close()


@pytest.fixture(autouse=True)
def _tier_setup(client):
    _build_tier_tree(client)
    yield


class TestTierScoping:
    def test_director_sees_directorate_subtree(self, client):
        tok = login(client, "director1")
        s, d = jget(client, "/api/weekly-plans/plan-performance", tok)
        assert s == 200
        assert d["tier"] == "director"
        # d1 subtree: emp 30,31,32,33,34,35,36 (not d2's people)
        ids = {x["employee_id"] for x in d["summaries"]}
        assert {30, 31, 32, 33, 34, 35, 36} <= ids
        assert not (ids & {7, 8})  # corporate services people excluded

    def test_dept_head_sees_department_subtree(self, client):
        tok = login(client, "depthead1")
        s, d = jget(client, "/api/weekly-plans/plan-performance", tok)
        assert s == 200
        assert d["tier"] == "dept_head"
        ids = {x["employee_id"] for x in d["summaries"]}
        # d10 subtree: 31,32,33,34,35,36 (dept head is in d10)
        assert {32, 33, 34, 35, 36} <= ids
        assert 30 not in ids  # director is outside d10 subtree (it's up-tree)
        assert 7 not in ids

    def test_team_leader_sees_team_only(self, client):
        tok = login(client, "lead1")
        s, d = jget(client, "/api/weekly-plans/plan-performance", tok)
        assert s == 200
        assert d["tier"] == "team_leader"
        ids = {x["employee_id"] for x in d["summaries"]}
        assert {32, 34, 35} <= ids  # lead + its team members
        assert 36 not in ids  # other team's member
        assert 33 not in ids

    def test_team_leader_cannot_see_other_team(self, client):
        # lead1 (team A) must not see team B's tasks via plan-performance
        tok = login(client, "lead1")
        s, d = jget(client, "/api/weekly-plans/plan-performance", tok)
        ids = {x["employee_id"] for x in d["summaries"]}
        assert 36 not in ids

    def test_employee_blocked_from_plan_performance(self, client):
        tok = login(client, "employee1")
        s, d = jget(client, "/api/weekly-plans/plan-performance", tok)
        assert s == 403


class TestPlanPerformanceData:
    def test_plan_completion_counts(self, client):
        # emp34 in team A does 2 tasks (1 done)
        etok = login(client, "emp20")
        jpost(client, "/api/weekly-plans/current",
              {"tasks": [
                  {"title": "T1", "status": "done", "day_of_week": 1},
                  {"title": "T2", "status": "todo", "day_of_week": 2},
              ]}, etok)

        tok = login(client, "lead1")
        s, d = jget(client, "/api/weekly-plans/plan-performance", tok)
        assert s == 200
        emp = next(x for x in d["summaries"] if x["employee_id"] == 34)
        assert emp["total_tasks"] == 2
        assert emp["done_tasks"] == 1
        assert emp["completion_pct"] == 50


class TestTodayTasks:
    def test_today_returns_own_tasks(self, client):
        tok = login(client, "emp20")
        jpost(client, "/api/weekly-plans/current",
              {"tasks": [
                  {"title": "Monday task", "status": "todo", "day_of_week": 1},
                  {"title": "Mid-week task", "status": "todo", "day_of_week": 3},
                  {"title": "Unassigned", "status": "todo", "day_of_week": None},
              ]}, tok)
        s, d = jget(client, "/api/weekly-plans/today", tok)
        assert s == 200
        assert "today" in d
        assert "all_pending" in d
        # Unassigned tasks are always surfaced in today's list
        titles = {t["title"] for t in d["today"]}
        assert "Unassigned" in titles

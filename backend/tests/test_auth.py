"""Authentication, JWT, and role enforcement tests."""

import pytest
from conftest import login, jget, jpost, jput, jdel, auth_header


class TestLogin:
    def test_valid_login(self, client):
        s, d = jpost(client, "/api/auth/login", {"username": "manager1", "password": "password123"})
        assert s == 200
        assert "token" in d
        assert d["user"]["role"] == "manager"
        assert d["user"]["username"] == "manager1"

    def test_wrong_password(self, client):
        s, d = jpost(client, "/api/auth/login", {"username": "manager1", "password": "wrong"})
        assert s == 401

    def test_nonexistent_user(self, client):
        s, d = jpost(client, "/api/auth/login", {"username": "nobody", "password": "password123"})
        assert s == 401

    def test_missing_fields(self, client):
        s, d = jpost(client, "/api/auth/login", {})
        assert s == 400


class TestJWT:
    def test_valid_token_accesses_protected_route(self, client):
        tok = login(client)
        s, d = jget(client, "/api/programs", tok)
        assert s == 200

    def test_missing_token(self, client):
        s, d = jget(client, "/api/programs")
        assert s == 401

    def test_invalid_token(self, client):
        s, d = jget(client, "/api/programs", "garbage-token")
        assert s == 401


class TestRoleEnforcement:
    def test_employee_blocked_from_create_program(self, client):
        tok = login(client, "employee1")
        s, d = jpost(client, "/api/programs", {"name": "Nope"}, tok)
        assert s == 403

    def test_employee_blocked_from_create_activity(self, client):
        tok = login(client, "employee1")
        s, d = jpost(client, "/api/programs/1/activities", {"title": "Nope"}, tok)
        assert s == 403

    def test_employee_blocked_from_update_program(self, client):
        tok = login(client, "employee1")
        s, d = jput(client, "/api/programs/1", {"name": "Nope"}, tok)
        assert s == 403

    def test_employee_blocked_from_delete_program(self, client):
        tok = login(client, "employee1")
        s, d = jdel(client, "/api/programs/1", tok)
        assert s == 403

    def test_employee_blocked_from_create_kpi(self, client):
        tok = login(client, "employee1")
        s, d = jpost(client, "/api/programs/activities/1/kpis", {"name": "Nope", "kpi_type": "percentage"}, tok)
        assert s == 403

    def test_manager_can_create_program(self, client):
        tok = login(client, "manager1")
        s, d = jpost(client, "/api/programs", {"name": "OK"}, tok)
        assert s == 201

    def test_executive_can_create_program(self, client):
        tok = login(client, "exec1")
        s, d = jpost(client, "/api/programs", {"name": "OK"}, tok)
        assert s == 201

    def test_admin_can_create_program(self, client):
        tok = login(client, "admin1")
        s, d = jpost(client, "/api/programs", {"name": "OK"}, tok)
        assert s == 201


class TestDemoAccountsEndpoint:
    def test_admin_can_access(self, client):
        tok = login(client, "admin1")
        s, d = jget(client, "/api/reference/demo-accounts", tok)
        assert s == 200
        assert isinstance(d, list)

    def test_manager_blocked(self, client):
        tok = login(client, "manager1")
        s, d = jget(client, "/api/reference/demo-accounts", tok)
        assert s == 403

    def test_no_passwords_exposed(self, client):
        tok = login(client, "admin1")
        s, d = jget(client, "/api/reference/demo-accounts", tok)
        assert s == 200
        for acct in d:
            assert "password" not in acct
            assert "password_hash" not in acct


class TestAccountManagement:
    def test_password_reset_preserves_role(self, client):
        tok = login(client, "admin1")
        # Get manager1 employee id
        s, emps = jget(client, "/api/employees", tok)
        assert s == 200
        mgr = next(e for e in emps if e["username"] == "manager1")
        assert mgr["role"] == "manager"

        # Admin resets manager's password without specifying role
        s, res = jpost(client, f"/api/employees/{mgr['id']}/account", {}, tok)
        assert s == 200
        assert res["ok"] is True
        assert res["role"] == "manager"
        temp_pwd = res["temp_password"]

        # Log in as manager1 with the temp password and check role is still manager
        s, login_res = jpost(client, "/api/auth/login", {"username": "manager1", "password": temp_pwd})
        assert s == 200
        assert login_res["user"]["role"] == "manager"

    def test_edit_employee_updates_role(self, client):
        tok = login(client, "admin1")
        s, emps = jget(client, "/api/employees", tok)
        emp = next(e for e in emps if e["username"] == "employee1")

        # Update role to manager
        s, res = jput(client, f"/api/employees/{emp['id']}", {
            "full_name": emp["full_name"],
            "email": emp["email"],
            "role": "manager",
            "employment_status": "active"
        }, tok)
        assert s == 200

        # Check in employees list
        s, updated_emps = jget(client, "/api/employees", tok)
        updated_emp = next(e for e in updated_emps if e["id"] == emp["id"])
        assert updated_emp["role"] == "manager"

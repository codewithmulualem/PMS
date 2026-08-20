"""Shared fixtures for the PMS backend test suite."""

import os
import sqlite3
import tempfile

import pytest

# Point at a fresh temp DB before importing anything else
_tmpdir = tempfile.mkdtemp()
_test_db = os.path.join(_tmpdir, "test_pms.db")
os.environ["PMS_DB_PATH"] = _test_db

# Patch database module to use our temp path
import database
database.DB_PATH = _test_db

from app import app as flask_app
import auth


@pytest.fixture(autouse=True)
def _fresh_db():
    """Rebuild the database from scratch for every test."""
    # Delete and recreate the DB file
    if os.path.exists(_test_db):
        os.unlink(_test_db)
    conn = sqlite3.connect(_test_db)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    with open(os.path.join(os.path.dirname(__file__), "..", "schema.sql")) as f:
        conn.executescript(f.read())
    database.apply_migrations(conn)
    _seed_minimal(conn)
    conn.close()
    yield


def _seed_minimal(conn):
    """Insert the minimal data every test needs."""
    from auth import hash_password
    pwd = hash_password("password123")

    conn.executescript("""
        INSERT INTO departments (id, name) VALUES (1, 'Environmental Regulatory'), (2, 'Corporate Services');

        INSERT INTO employees (id, full_name, email, position, department_id, manager_id, employment_status)
        VALUES
            (1, 'Rediat Amare',    'rediat@test.com',  'HR Director',           2, NULL, 'active'),
            (2, 'Dr. Lelise Neme', 'lelise@test.com',  'Director General',      2, NULL, 'active'),
            (3, 'Ato Tesfaye Girma','tesfaye@test.com', 'Dir - Env. Regulatory', 1, 2,    'active'),
            (4, 'W/ro Hirut Bekele','hirut@test.com',   'Dir - Env. Systems',    2, 2,    'active'),
            (5, 'Ato Dawit Mekonnen','dawit@test.com',  'Sr ESIA Expert',        1, 3,    'active'),
            (6, 'W/ro Fatuma Ahmed','fatuma@test.com',  'Env. Inspector',        1, 3,    'active'),
            (7, 'Ato Bereket Tesfa','bereket@test.com', 'Climate Change Spec',   2, 4,    'active'),
            (8, 'W/ro Sara Tadesse','sara@test.com',    'ICT Officer',           2, 4,    'active');

        INSERT INTO performance_cycles (id, name, status)
        VALUES (1, 'Q1 2026', 'active');

        INSERT INTO roles (id, name, system_default)
        VALUES (1, 'admin', 1), (2, 'executive', 1), (3, 'manager', 1), (4, 'employee', 1);

        INSERT INTO reporting_relationships (employee_id, supervisor_id, relationship_type, is_active)
        VALUES
            (3, 2, 'primary', 1),
            (4, 2, 'primary', 1),
            (5, 3, 'primary', 1),
            (6, 3, 'primary', 1),
            (7, 4, 'primary', 1),
            (8, 4, 'primary', 1);
    """)
    conn.execute(
        "INSERT INTO users (id, username, password_hash, role, employee_id) VALUES (1, 'admin1', ?, 'admin', 1)",
        (pwd,),
    )
    conn.execute(
        "INSERT INTO users (id, username, password_hash, role, employee_id) VALUES (2, 'exec1', ?, 'executive', 2)",
        (pwd,),
    )
    conn.execute(
        "INSERT INTO users (id, username, password_hash, role, employee_id) VALUES (3, 'manager1', ?, 'manager', 3)",
        (pwd,),
    )
    conn.execute(
        "INSERT INTO users (id, username, password_hash, role, employee_id) VALUES (4, 'manager2', ?, 'manager', 4)",
        (pwd,),
    )
    conn.execute(
        "INSERT INTO users (id, username, password_hash, role, employee_id) VALUES (5, 'employee1', ?, 'employee', 5)",
        (pwd,),
    )
    conn.execute(
        "INSERT INTO users (id, username, password_hash, role, employee_id) VALUES (6, 'employee2', ?, 'employee', 6)",
        (pwd,),
    )
    conn.commit()


@pytest.fixture
def app():
    """Yield the Flask app configured for testing."""
    flask_app.config["TESTING"] = True
    yield flask_app


@pytest.fixture
def client(app):
    """A Flask test client."""
    return app.test_client()


def login(client, username="manager1", password="password123"):
    """Login and return the JWT token string."""
    resp = client.post("/api/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, f"Login failed: {resp.get_json()}"
    return resp.get_json()["token"]


def auth_header(token):
    """Return the Authorization header dict."""
    return {"Authorization": f"Bearer {token}"}


def jget(client, path, token=None):
    """GET with optional auth, returns (status_code, json_data)."""
    headers = auth_header(token) if token else {}
    resp = client.get(path, headers=headers)
    return resp.status_code, resp.get_json()


def jpost(client, path, data=None, token=None):
    """POST with optional auth, returns (status_code, json_data)."""
    headers = {"Content-Type": "application/json"}
    if token:
        headers.update(auth_header(token))
    resp = client.post(path, json=data or {}, headers=headers)
    return resp.status_code, resp.get_json()


def jput(client, path, data=None, token=None):
    """PUT with optional auth, returns (status_code, json_data)."""
    headers = {"Content-Type": "application/json"}
    if token:
        headers.update(auth_header(token))
    resp = client.put(path, json=data or {}, headers=headers)
    return resp.status_code, resp.get_json()


def jdel(client, path, token=None):
    """DELETE with optional auth, returns (status_code, json_data)."""
    headers = auth_header(token) if token else {}
    resp = client.delete(path, headers=headers)
    return resp.status_code, resp.get_json()

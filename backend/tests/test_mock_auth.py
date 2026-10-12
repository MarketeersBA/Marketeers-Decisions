"""Development mock sign-in: local tokens, no Cognito."""

from __future__ import annotations

import jwt
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

import config
from api.main import app
from db.models import ClientRow, OptimizerJobRow, StudyRow
from db.session import session_scope


def _enable(monkeypatch, tmp_path, *, auth: str = "mock", app_env: str = "development") -> TestClient:
    monkeypatch.setattr(config, "MARKET_SIM_AUTH", auth)
    monkeypatch.setattr(config, "APP_ENV", app_env)
    monkeypatch.setattr("api.auth.mock_dir", lambda: tmp_path)
    return TestClient(app)


def _sub(token: str) -> str:
    claims = jwt.decode(token, options={"verify_signature": False})
    return str(claims["sub"])


def _cleanup(subs: list[str]) -> None:
    if not subs:
        return
    with session_scope() as session:
        ids = list(
            session.scalars(select(ClientRow.id).where(ClientRow.cognito_sub.in_(subs))).all()
        )
        if not ids:
            return
        session.execute(delete(OptimizerJobRow).where(OptimizerJobRow.client_id.in_(ids)))
        session.execute(delete(StudyRow).where(StudyRow.client_id.in_(ids)))
        session.execute(delete(ClientRow).where(ClientRow.id.in_(ids)))


def _register(client: TestClient, email: str, password: str = "secret-pass") -> str:
    assert client.post("/api/auth/mock/signup", json={"email": email, "password": password}).status_code == 200
    assert (
        client.post("/api/auth/mock/confirm", json={"email": email, "code": "000000"}).status_code
        == 200
    )
    response = client.post("/api/auth/mock/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return response.json()["idToken"]


def test_two_mock_accounts_are_different_tenants(monkeypatch, tmp_path) -> None:
    client = _enable(monkeypatch, tmp_path)
    subs: list[str] = []
    try:
        assert client.get("/api/auth/config").json() == {"mode": "mock"}
        assert client.get("/api/studies").status_code == 401

        assert (
            client.post(
                "/api/auth/mock/signup",
                json={"email": "new@example.com", "password": "secret-pass"},
            ).status_code
            == 200
        )
        assert (
            client.post(
                "/api/auth/mock/login",
                json={"email": "new@example.com", "password": "secret-pass"},
            ).status_code
            == 401
        )
        assert (
            client.post(
                "/api/auth/mock/login",
                json={"email": "new@example.com", "password": "wrong"},
            ).status_code
            == 401
        )
        assert (
            client.post(
                "/api/auth/mock/confirm",
                json={"email": "new@example.com", "code": "111111"},
            ).status_code
            == 400
        )
        assert (
            client.post(
                "/api/auth/mock/signup",
                json={"email": "new@example.com", "password": "secret-pass"},
            ).status_code
            == 400
        )

        token_a = _register(client, "a@example.com")
        token_b = _register(client, "b@example.com")
        subs.extend([_sub(token_a), _sub(token_b)])
        assert subs[0] != subs[1]

        assert client.get("/api/studies", headers={"Authorization": f"Bearer {token_a}"}).status_code == 200
        assert client.get("/api/studies", headers={"Authorization": f"Bearer {token_b}"}).status_code == 200
        with session_scope() as session:
            ids = list(
                session.scalars(select(ClientRow.id).where(ClientRow.cognito_sub.in_(subs))).all()
            )
        assert len(ids) == 2
        assert ids[0] != ids[1]
    finally:
        _cleanup(subs)


def test_mock_routes_404_when_auth_is_dev(monkeypatch, tmp_path) -> None:
    client = _enable(monkeypatch, tmp_path, auth="dev")
    assert client.get("/api/auth/config").json()["mode"] == "dev"
    assert (
        client.post(
            "/api/auth/mock/signup",
            json={"email": "a@example.com", "password": "secret-pass"},
        ).status_code
        == 404
    )
    assert client.post("/api/auth/mock/login", json={"email": "a@example.com", "password": "x"}).status_code == 404


def test_mock_is_disabled_outside_development(monkeypatch, tmp_path) -> None:
    client = _enable(monkeypatch, tmp_path, app_env="production")
    assert client.get("/api/auth/config").json()["mode"] == "dev"
    assert (
        client.post(
            "/api/auth/mock/signup",
            json={"email": "a@example.com", "password": "secret-pass"},
        ).status_code
        == 404
    )
    assert client.get("/api/studies").status_code == 500
    assert not (tmp_path / "users.json").exists()
    assert not (tmp_path / "key.pem").exists()

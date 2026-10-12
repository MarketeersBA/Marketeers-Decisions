"""Cognito token checks and cross-tenant isolation."""

from __future__ import annotations

import time

import jwt
import pandas as pd
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from jwt.algorithms import RSAAlgorithm
from sqlalchemy import delete, select

import config
from api.auth import clear_jwks_cache
from api.main import app
from api.routes.optimizer import JobRecord, _jobs
from api.routes.wizard import wizard_sessions
from api.sessions import _Session, session_manager
from data.storage.local import LocalStorageBackend
from db.models import ClientRow, OptimizerJobRow, StudyRow
from db.repository import StudyRepository
from db.session import session_scope
from model.study_schema import StudyDocument, StudyMeta

POOL_ID = "eu-west-1_test"
CLIENT_ID = "testclient"
ISSUER = f"https://cognito-idp.eu-west-1.amazonaws.com/{POOL_ID}"
SLUG = "Same_Slug"


def _key_and_jwks():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json_jwk(private_key.public_key())
    return private_key, {"keys": [jwk]}


def json_jwk(public_key) -> dict:
    data = RSAAlgorithm.to_jwk(public_key)
    import json

    jwk = json.loads(data)
    jwk.update({"kid": "test-key", "use": "sig", "alg": "RS256"})
    return jwk


def _token(private_key, sub: str, *, aud: str = CLIENT_ID, exp: int | None = None) -> str:
    payload = {
        "sub": sub,
        "email": f"{sub}@example.com",
        "aud": aud,
        "iss": ISSUER,
        "token_use": "id",
        "exp": exp if exp is not None else int(time.time()) + 3600,
    }
    encoded = jwt.encode(payload, private_key, algorithm="RS256", headers={"kid": "test-key"})
    return encoded if isinstance(encoded, str) else encoded.decode()


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def cognito_client(monkeypatch, tmp_path):
    private_key, jwks = _key_and_jwks()
    monkeypatch.setattr(config, "MARKET_SIM_AUTH", "cognito")
    monkeypatch.setattr(config, "COGNITO_REGION", "eu-west-1")
    monkeypatch.setattr(config, "COGNITO_USER_POOL_ID", POOL_ID)
    monkeypatch.setattr(config, "COGNITO_APP_CLIENT_ID", CLIENT_ID)
    monkeypatch.setattr(config, "STUDIES_DIR", tmp_path)
    monkeypatch.setattr("api.auth._fetch_jwks", lambda: jwks)
    clear_jwks_cache()
    yield TestClient(app), private_key
    clear_jwks_cache()


def _client_id_for(sub: str) -> str:
    with session_scope() as session:
        row = session.scalar(select(ClientRow).where(ClientRow.cognito_sub == sub))
        assert row is not None
        return row.id


def _cleanup(subs: tuple[str, ...]) -> None:
    with session_scope() as session:
        ids = list(
            session.scalars(select(ClientRow.id).where(ClientRow.cognito_sub.in_(subs))).all()
        )
        if not ids:
            return
        session.execute(delete(OptimizerJobRow).where(OptimizerJobRow.client_id.in_(ids)))
        session.execute(delete(StudyRow).where(StudyRow.client_id.in_(ids)))
        session.execute(delete(ClientRow).where(ClientRow.id.in_(ids)))


def test_invalid_and_expired_tokens(cognito_client) -> None:
    client, private_key = cognito_client
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    assert client.get("/api/health").status_code == 200
    config_body = client.get("/api/auth/config").json()
    assert config_body["mode"] == "cognito"
    assert config_body["clientId"] == CLIENT_ID

    assert client.get("/api/studies").status_code == 401
    assert client.get("/api/studies", headers=_auth("not-a-token")).status_code == 401
    assert (
        client.get("/api/studies", headers=_auth(_token(other, "sub-x"))).status_code == 401
    )
    assert (
        client.get(
            "/api/studies",
            headers=_auth(_token(private_key, "sub-x", aud="wrong-client")),
        ).status_code
        == 401
    )
    assert (
        client.get(
            "/api/studies",
            headers=_auth(_token(private_key, "sub-x", exp=int(time.time()) - 60)),
        ).status_code
        == 401
    )


def test_two_tenants_with_the_same_slug_stay_isolated(cognito_client) -> None:
    client, private_key = cognito_client
    token_a = _token(private_key, "sub-a")
    token_b = _token(private_key, "sub-b")
    headers_a = _auth(token_a)
    headers_b = _auth(token_b)
    subs = ("sub-a", "sub-b")
    session_id = "tenant-a-session"
    job_id = "tenant-a-job"
    wizard_id = "tenant-a-wizard"
    try:
        assert client.get("/api/studies", headers=headers_a).status_code == 200
        assert client.get("/api/studies", headers=headers_b).status_code == 200
        client_a = _client_id_for("sub-a")
        client_b = _client_id_for("sub-b")
        assert client_a != client_b

        storage = LocalStorageBackend()
        hbu = pd.DataFrame({"RespondentID": [1]})
        slug_a = storage.write_study(
            client_a,
            StudyDocument(meta=StudyMeta(study_name="Same Slug", company_name="Alpha", price_currency_symbol="€")),
            hbu,
        )
        slug_b = storage.write_study(
            client_b,
            StudyDocument(meta=StudyMeta(study_name="Same Slug", company_name="Beta", price_currency_symbol="€")),
            hbu,
        )
        assert slug_a == slug_b == SLUG
        StudyRepository().add(client_a, SLUG, "Same Slug", "Alpha", set_default=True)
        StudyRepository().add(client_b, SLUG, "Same Slug", "Beta", set_default=True)

        listed_a = client.get("/api/studies", headers=headers_a).json()
        listed_b = client.get("/api/studies", headers=headers_b).json()
        assert [row["company"] for row in listed_a if row["slug"] == SLUG] == ["Alpha"]
        assert [row["company"] for row in listed_b if row["slug"] == SLUG] == ["Beta"]

        meta_a = client.get(f"/api/studies/{SLUG}/meta", headers=headers_a)
        meta_b = client.get(f"/api/studies/{SLUG}/meta", headers=headers_b)
        assert meta_a.status_code == 200
        assert meta_b.status_code == 200

        edited = client.patch(
            f"/api/studies/{SLUG}/meta",
            json={"price_currency_symbol": "$"},
            headers=headers_a,
        )
        assert edited.status_code == 200
        alpha, _ = storage.load_study(client_a, SLUG)
        beta, _ = storage.load_study(client_b, SLUG)
        assert alpha.meta.price_currency_symbol == "$"
        assert beta.meta.price_currency_symbol == "€"

        class _Project:
            def __init__(self) -> None:
                self.initialized = 0
                self.results = pd.DataFrame({"Product Name": ["A"]})
                self.study_name = "Same Slug"
                self.group_types: list[str] = []
                self.scenario_name = ""

            def initialize(self) -> None:
                self.initialized += 1

        project_a = _Project()
        project_b = _Project()
        session_manager._sessions[session_id] = _Session(
            project=project_a, slug=SLUG, client_id=client_a
        )
        session_manager._sessions["tenant-b-session"] = _Session(
            project=project_b, slug=SLUG, client_id=client_b
        )

        session_manager.reload_study_for_slug(client_b, SLUG)
        assert project_a.initialized == 0
        assert project_b.initialized == 1
        session_manager.reload_study_for_slug(client_a, SLUG)
        assert project_a.initialized == 1

        own_export = client.get(
            f"/api/sessions/{session_id}/export",
            params={"format": "csv"},
            headers=headers_a,
        )
        other_export = client.get(
            f"/api/sessions/{session_id}/export",
            params={"format": "csv"},
            headers=headers_b,
        )
        assert own_export.status_code == 200
        assert other_export.status_code == 404
        other_edit = client.post(
            f"/api/sessions/{session_id}/recalculate",
            json={"changes": []},
            headers=headers_b,
        )
        assert other_edit.status_code == 404

        _jobs[job_id] = JobRecord(
            job_id=job_id,
            slug=SLUG,
            client_id=client_a,
            status="running",
        )
        assert client.get(f"/api/{SLUG}/optimizer/jobs/{job_id}", headers=headers_a).status_code == 200
        assert client.get(f"/api/{SLUG}/optimizer/jobs/{job_id}", headers=headers_b).status_code == 404
        assert (
            client.post(f"/api/{SLUG}/optimizer/jobs/{job_id}/cancel", headers=headers_b).status_code
            == 404
        )
        assert (
            client.post(f"/api/{SLUG}/optimizer/jobs/{job_id}/export", headers=headers_b).status_code
            == 404
        )
        cancelled = client.post(f"/api/{SLUG}/optimizer/jobs/{job_id}/cancel", headers=headers_a)
        assert cancelled.status_code == 200
        assert _jobs[job_id].status == "cancelled"
        assert (
            client.post(f"/api/{SLUG}/optimizer/jobs/{job_id}/export", headers=headers_a).status_code
            == 400
        )

        wizard_sessions[wizard_id] = {"doc": None, "hbu": None, "client_id": client_a}
        files = {"file": ("hbu.xlsx", b"not-a-workbook", "application/vnd.ms-excel")}
        blocked = client.post(
            "/api/wizard/hbu",
            data={"wizard_id": wizard_id},
            files=files,
            headers=headers_b,
        )
        assert blocked.status_code == 404
        owner = client.post(
            "/api/wizard/hbu",
            data={"wizard_id": wizard_id},
            files=files,
            headers=headers_a,
        )
        assert owner.status_code == 400
    finally:
        session_manager._sessions.pop(session_id, None)
        session_manager._sessions.pop("tenant-b-session", None)
        _jobs.pop(job_id, None)
        wizard_sessions.pop(wizard_id, None)
        _cleanup(subs)

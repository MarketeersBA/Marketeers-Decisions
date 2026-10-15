"""PATCH study identity keeps catalog, study.json, and live sessions aligned."""

from __future__ import annotations

import uuid

import pandas as pd
import pytest
from fastapi.testclient import TestClient

import config
from api.main import create_app
from api.sessions import session_manager
from data.storage.local import LocalStorageBackend
from data.study_writer import write_study
from db.repository import StudyRepository
from model.study_schema import StudyDocument, StudyMeta


@pytest.fixture
def identity_env(tmp_path, monkeypatch):
    monkeypatch.setenv("MARKET_SIM_STUDIES_DIR", str(tmp_path))
    monkeypatch.setattr(config, "STUDIES_DIR", tmp_path)
    monkeypatch.setattr(config, "MARKET_SIM_AUTH", "dev")
    backend = LocalStorageBackend()
    monkeypatch.setattr(config, "_storage_backend", backend)
    client_id = f"client-{uuid.uuid4().hex[:8]}"
    monkeypatch.setattr(config, "MARKET_SIM_DEV_CLIENT_ID", client_id)
    return backend, client_id


def test_patch_updates_catalog_document_and_live_session(identity_env) -> None:
    backend, client_id = identity_env
    doc = StudyDocument(meta=StudyMeta(study_name="Launch Study", company_name="Acme"))
    hbu = pd.DataFrame({"RespondentID": [1], "ProductID1": [0.5]})
    slug = write_study(doc, hbu, client_id=client_id)
    assert slug == "Launch_Study"

    # Live session loaded before the rename
    session_id = session_manager.create(slug, client_id)
    live_before = session_manager.get(session_id, client_id)
    assert live_before.study_name == "Launch Study"
    assert live_before.company_name == "Acme"

    app = create_app()
    client = TestClient(app)
    res = client.patch(
        f"/api/studies/{slug}",
        json={"name": "Launch Study Renamed", "company": "Acme Corp"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == "Launch Study Renamed"
    assert body["company"] == "Acme Corp"

    # Catalog
    entry = StudyRepository().get_by_slug(client_id, slug)
    assert entry is not None
    assert entry.name == "Launch Study Renamed"
    assert entry.company == "Acme Corp"

    # study.json
    loaded, _ = backend.load_study(client_id, slug)
    assert loaded.meta.study_name == "Launch Study Renamed"
    assert loaded.meta.company_name == "Acme Corp"

    # Live session (no recreate)
    live = session_manager.get(session_id, client_id)
    assert live.study_name == "Launch Study Renamed"
    assert live.company_name == "Acme Corp"

    session_manager.close(session_id, client_id)

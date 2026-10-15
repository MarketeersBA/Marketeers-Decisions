"""Tests for study persistence, atomic writes, rollback, and collision protection."""

from __future__ import annotations

import pandas as pd
import pytest
from unittest.mock import MagicMock

import config
from data.storage.local import LocalStorageBackend
from data.study_writer import StudyConflictError, write_study
from db.repository import StudyRepository
from model.study_schema import StudyDocument, StudyMeta


@pytest.fixture
def clean_storage(tmp_path, monkeypatch):
    monkeypatch.setenv("MARKET_SIM_STUDIES_DIR", str(tmp_path))
    monkeypatch.setattr(config, "STUDIES_DIR", tmp_path)
    monkeypatch.setattr(config, "MARKET_SIM_AUTH", "dev")
    backend = LocalStorageBackend()
    monkeypatch.setattr(config, "_storage_backend", backend)
    return backend, tmp_path


def test_atomic_staging_cleans_up_on_parquet_failure(clean_storage, monkeypatch) -> None:
    backend, tmp_path = clean_storage
    doc = StudyDocument(meta=StudyMeta(study_name="Atomic Test", company_name="Co"))

    # Mock hbu_df to raise an error during to_parquet
    bad_df = MagicMock()
    bad_df.to_parquet.side_effect = RuntimeError("Disk write failed during parquet serialization")

    with pytest.raises(RuntimeError, match="Disk write failed"):
        backend.write_study("test-client", doc, bad_df)

    # Ensure target study folder was never partially created
    target_folder = backend.study_root_path("test-client", "atomic_test")
    assert not (target_folder / "study.json").exists()
    assert not (target_folder / "hbu.parquet").exists()


def test_write_study_compensating_rollback_on_db_failure(clean_storage, monkeypatch) -> None:
    backend, tmp_path = clean_storage
    doc = StudyDocument(meta=StudyMeta(study_name="Rollback Study", company_name="Co"))
    hbu = pd.DataFrame({"RespondentID": [1], "ProductID1": [0.5]})

    # Mock StudyRepository.add to raise an exception
    def failing_add(*args, **kwargs):
        raise RuntimeError("Database connection lost during commit")

    monkeypatch.setattr(StudyRepository, "add", failing_add)

    with pytest.raises(RuntimeError, match="Database connection lost"):
        write_study(doc, hbu, client_id="test-client", allow_overwrite=True)

    # Storage tree must have been deleted by the compensating rollback
    assert not backend.study_exists("test-client", "rollback_study")


def test_write_study_prevents_overwrite_when_disallowed(clean_storage) -> None:
    backend, tmp_path = clean_storage
    doc = StudyDocument(meta=StudyMeta(study_name="Unique Study", company_name="Co"))
    hbu = pd.DataFrame({"RespondentID": [1], "ProductID1": [0.5]})

    slug1 = write_study(doc, hbu, client_id="test-client", allow_overwrite=True)
    assert slug1 == "Unique_Study"

    # Second write with allow_overwrite=False should raise StudyConflictError
    with pytest.raises(StudyConflictError, match="already exists"):
        write_study(doc, hbu, client_id="test-client", allow_overwrite=False)


def test_make_unique_slug_increments_suffix(clean_storage) -> None:
    import uuid
    client_id = f"client-{uuid.uuid4().hex[:8]}"
    backend, tmp_path = clean_storage
    repo = StudyRepository()
    doc = StudyDocument(meta=StudyMeta(study_name="Product Launch", company_name="Co"))
    hbu = pd.DataFrame({"RespondentID": [1], "ProductID1": [0.5]})

    slug1 = write_study(doc, hbu, client_id=client_id)
    assert slug1 == "Product_Launch"

    unique_slug_2 = repo.make_unique_slug(client_id, "Product Launch")
    assert unique_slug_2 == "Product_Launch_2"

    write_study(doc, hbu, client_id=client_id, slug=unique_slug_2)
    unique_slug_3 = repo.make_unique_slug(client_id, "Product Launch")
    assert unique_slug_3 == "Product_Launch_3"


def test_create_study_endpoint_conflict_and_disambiguation(clean_storage, monkeypatch) -> None:
    import uuid
    from fastapi.testclient import TestClient
    from api.main import create_app
    from api.routes.wizard import wizard_sessions

    client_id = f"client-{uuid.uuid4().hex[:8]}"
    monkeypatch.setattr(config, "MARKET_SIM_DEV_CLIENT_ID", client_id)

    app = create_app()
    client = TestClient(app)

    doc = StudyDocument(meta=StudyMeta(study_name="API Study", company_name="Co"))
    hbu = pd.DataFrame({"RespondentID": [1], "ProductID1": [0.5]})
    wizard_id = f"test-wiz-{uuid.uuid4().hex[:8]}"
    wizard_sessions[wizard_id] = {
        "client_id": client_id,
        "doc": doc,
        "hbu": hbu,
    }

    # 1. First creation succeeds
    res1 = client.post("/api/studies", json={"wizard_id": wizard_id, "name": "API Study"})
    assert res1.status_code == 200
    assert res1.json()["slug"] == "API_Study"

    # 2. Duplicate without allow_overwrite returns 409
    wizard_id2 = f"test-wiz-{uuid.uuid4().hex[:8]}"
    wizard_sessions[wizard_id2] = {
        "client_id": client_id,
        "doc": doc,
        "hbu": hbu,
    }
    res2 = client.post("/api/studies", json={"wizard_id": wizard_id2, "name": "API Study", "allow_overwrite": False})
    assert res2.status_code == 409
    assert "already exists" in res2.json()["detail"]

    # 3. Duplicate with auto_disambiguate creates API_Study_2
    res3 = client.post("/api/studies", json={"wizard_id": wizard_id2, "name": "API Study", "auto_disambiguate": True})
    assert res3.status_code == 200
    assert res3.json()["slug"] == "API_Study_2"

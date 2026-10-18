"""Optimizer job persistence, restart reconciliation, and retention."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from api.main import app
from api.routes.optimizer import _jobs
from config import MARKET_SIM_DEV_CLIENT_ID
from db.models import ClientRow, OptimizerJobRow, StudyRow, new_uuid
from db.repository import (
    INTERRUPTED_JOB_ERROR,
    OptimizerJobRepository,
)
from db.session import session_scope
client = TestClient(app)

CLIENT_ID = MARKET_SIM_DEV_CLIENT_ID
SLUG = "_pytest_opt_jobs"


@pytest.fixture
def study_row():
    """Ensure a catalog study row exists for CLIENT_ID / SLUG; clean jobs after."""
    with session_scope() as session:
        if session.get(ClientRow, CLIENT_ID) is None:
            session.add(ClientRow(id=CLIENT_ID, email="dev@local"))
        existing = session.scalar(
            select(StudyRow).where(StudyRow.client_id == CLIENT_ID, StudyRow.slug == SLUG)
        )
        if existing is None:
            study_id = new_uuid()
            session.add(
                StudyRow(
                    id=study_id,
                    client_id=CLIENT_ID,
                    slug=SLUG,
                    name="Pytest Optimizer Jobs",
                    company="",
                    is_default=False,
                )
            )
        else:
            study_id = existing.id
            existing.deleted_at = None
    yield study_id
    with session_scope() as session:
        session.execute(delete(OptimizerJobRow).where(OptimizerJobRow.study_id == study_id))


def test_upsert_progress_does_not_wipe_payload(study_row: str) -> None:
    repo = OptimizerJobRepository()
    job_id = new_uuid().replace("-", "")
    payload = {"request": {"brand": "X"}, "result": {"prices": {"A": 1.0}}, "baseline": {}}
    repo.upsert(
        job_id,
        CLIENT_ID,
        study_row,
        status="done",
        evals=10,
        estimated_evals=20,
        best_obj=1.5,
        payload=payload,
    )
    repo.upsert(
        job_id,
        CLIENT_ID,
        study_row,
        status="done",
        evals=11,
        estimated_evals=20,
        best_obj=1.6,
    )
    row = repo.get(job_id, CLIENT_ID)
    assert row is not None
    assert row["evals"] == 11
    assert row["best_obj"] == 1.6
    assert row["payload"] == payload
    assert row["finished_at"] is not None


def test_reconcile_interrupted_marks_running_as_error(study_row: str) -> None:
    repo = OptimizerJobRepository()
    job_id = new_uuid().replace("-", "")
    repo.upsert(
        job_id,
        CLIENT_ID,
        study_row,
        status="running",
        evals=3,
        estimated_evals=50,
        best_obj=0.1,
    )
    n = repo.reconcile_interrupted()
    assert n >= 1
    row = repo.get(job_id, CLIENT_ID)
    assert row is not None
    assert row["status"] == "error"
    assert row["error"] == INTERRUPTED_JOB_ERROR
    assert row["finished_at"] is not None


def test_cleanup_expired_deletes_old_terminal_jobs(study_row: str) -> None:
    repo = OptimizerJobRepository()
    old_id = new_uuid().replace("-", "")
    fresh_id = new_uuid().replace("-", "")
    repo.upsert(
        old_id,
        CLIENT_ID,
        study_row,
        status="done",
        evals=1,
        payload={"result": {"prices": {}}},
    )
    repo.upsert(
        fresh_id,
        CLIENT_ID,
        study_row,
        status="done",
        evals=1,
        payload={"result": {"prices": {}}},
    )
    old_finished = datetime.now(timezone.utc) - timedelta(days=30)
    with session_scope() as session:
        row = session.get(OptimizerJobRow, old_id)
        assert row is not None
        row.finished_at = old_finished
        row.updated_at = old_finished

    deleted = repo.cleanup_expired(max_age_days=7)
    assert deleted >= 1
    assert repo.get(old_id, CLIENT_ID) is None
    assert repo.get(fresh_id, CLIENT_ID) is not None


def test_get_job_returns_persisted_result_after_memory_wipe(demo_slug: str) -> None:
    """Simulate process restart: job gone from _jobs but result stays in DB."""
    from db.repository import StudyRepository

    StudyRepository().add(CLIENT_ID, demo_slug, demo_slug, set_default=False)
    repo = OptimizerJobRepository()
    study_id = repo.study_id_for_slug(CLIENT_ID, demo_slug)
    assert study_id is not None

    job_id = new_uuid().replace("-", "")
    result = {
        "prices": {"SKU A": 2.5},
        "objective_value": 100.0,
        "baseline_value": 90.0,
        "uplift_pct": 11.11,
        "n_evals": 5,
        "sku_rows": [
            {
                "name": "SKU A",
                "optimized": True,
                "base_price": 2.0,
                "optimal_price": 2.5,
                "price_delta_pct": 25.0,
                "base_vol_share": 0.1,
                "new_vol_share": 0.12,
                "share_delta_pp": 0.02,
                "base_rev": 10.0,
                "new_rev": 12.0,
                "rev_delta_pct": 20.0,
                "base_val_share": 0.1,
                "new_val_share": 0.12,
            }
        ],
    }
    request = {
        "group_type": "Brand",
        "brand": "TestBrand",
        "bounds": [
            {
                "sku": "SKU A",
                "base_price": 2.0,
                "lo": 1.0,
                "hi": 3.0,
                "cost": 0.5,
                "included": True,
            }
        ],
        "objective": "revenue",
    }
    repo.upsert(
        job_id,
        CLIENT_ID,
        study_id,
        status="done",
        evals=5,
        estimated_evals=10,
        best_obj=100.0,
        payload={"request": request, "result": result, "baseline": {}},
    )
    _jobs.pop(job_id, None)

    try:
        response = client.get(f"/api/{demo_slug}/optimizer/jobs/{job_id}")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "done"
        assert body["result"] is not None
        assert body["result"]["prices"] == {"SKU A": 2.5}

        export = client.post(f"/api/{demo_slug}/optimizer/jobs/{job_id}/export")
        assert export.status_code == 200
        assert "SKU A" in export.text
        assert "text/csv" in export.headers.get("content-type", "")
    finally:
        with session_scope() as session:
            session.execute(delete(OptimizerJobRow).where(OptimizerJobRow.id == job_id))

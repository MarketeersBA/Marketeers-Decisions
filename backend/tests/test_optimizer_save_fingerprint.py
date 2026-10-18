"""Save-scenario refuses stale study/unit-cost fingerprints, including in-memory jobs."""

from __future__ import annotations

from fastapi.testclient import TestClient

from api.main import app
from api.routes.optimizer import (
    JobRecord,
    _baseline_fingerprint,
    _jobs,
)
from api.schemas import RunOptimizerRequest, SkuBoundInput
from config import MARKET_SIM_DEV_CLIENT_ID
from data.scenario_store import ScenarioStore
from model.project_core import ProjectCore

client = TestClient(app)
CLIENT_ID = MARKET_SIM_DEV_CLIENT_ID


def _minimal_request(brand: str = "TestBrand") -> RunOptimizerRequest:
    return RunOptimizerRequest(
        group_type="Brand",
        brand=brand,
        bounds=[
            SkuBoundInput(
                sku="SKU A",
                base_price=2.0,
                lo=1.0,
                hi=3.0,
                cost=0.5,
                included=True,
            )
        ],
        objective="revenue",
    )


def _seed_done_job(
    slug: str,
    *,
    baseline: dict | None,
    job_id: str = "fp_test_job",
) -> str:
    _jobs.pop(job_id, None)
    req = _minimal_request()
    job = JobRecord(
        job_id=job_id,
        slug=slug,
        client_id=CLIENT_ID,
        status="done",
        request=req,
        result_payload={"prices": {}, "sku_rows": []},
        baseline=baseline,
    )
    _jobs[job_id] = job
    return job_id


def test_baseline_fingerprint_includes_unit_cost_updated_at(demo_slug: str) -> None:
    req = _minimal_request()
    fp = _baseline_fingerprint(demo_slug, CLIENT_ID, req)
    assert "unit_cost_updated_at" in fp
    project = ProjectCore(demo_slug, client_id=CLIENT_ID)
    project.initialize()
    expected = (project.doc.meta.unit_cost_updated_at if project.doc else "") or ""
    assert fp["unit_cost_updated_at"] == expected


def test_save_scenario_rejects_missing_baseline_on_memory_job(demo_slug: str) -> None:
    job_id = _seed_done_job(demo_slug, baseline=None)
    try:
        response = client.post(
            f"/api/{demo_slug}/optimizer/jobs/{job_id}/save-scenario",
            json={"name": "Should Not Save", "description": ""},
        )
        assert response.status_code == 409
        assert "re-run" in response.json()["detail"].lower()
    finally:
        _jobs.pop(job_id, None)


def test_save_scenario_rejects_stale_unit_cost_fingerprint(demo_slug: str) -> None:
    req = _minimal_request()
    fp = _baseline_fingerprint(demo_slug, CLIENT_ID, req)
    stale = {**fp, "unit_cost_updated_at": "1999-01-01T00:00:00+00:00"}
    job_id = _seed_done_job(demo_slug, baseline=stale)
    try:
        response = client.post(
            f"/api/{demo_slug}/optimizer/jobs/{job_id}/save-scenario",
            json={"name": "Stale Unit Costs", "description": ""},
        )
        assert response.status_code == 409
        assert "re-run" in response.json()["detail"].lower()
    finally:
        _jobs.pop(job_id, None)


def test_save_scenario_accepts_matching_memory_fingerprint(demo_slug: str) -> None:
    req = _minimal_request()
    fp = _baseline_fingerprint(demo_slug, CLIENT_ID, req)
    job_id = _seed_done_job(demo_slug, baseline=fp, job_id="fp_ok_job")
    store = ScenarioStore(demo_slug, CLIENT_ID)
    name = "_pytest_opt_fp_ok"
    try:
        response = client.post(
            f"/api/{demo_slug}/optimizer/jobs/{job_id}/save-scenario",
            json={"name": name, "description": "fingerprint ok"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["scenario_name"] == name
        assert any(s["name"] == name for s in store.list_scenarios())
    finally:
        _jobs.pop(job_id, None)
        try:
            store.delete(name)
        except Exception:
            pass

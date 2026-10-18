"""Tests for validation scenario aggregate scoring."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from api.main import app
from model.analytics.validation import validation_rows, validation_scenario_score
from model.project_core import ProjectCore

client = TestClient(app)


def _save_legacy_validation_scenario(demo_slug: str, name: str) -> None:
    """Persist a validation-flagged scenario directly (API save with validation=true is deprecated)."""
    from data.scenario_store import ScenarioStore
    from model.project_core import ProjectCore

    project = ProjectCore(demo_slug)
    project.initialize()
    scenario = project.capture_scenario(name, "validation test", validation=True)
    ScenarioStore(demo_slug).save(scenario)


def test_save_validation_scenario_via_api_rejected(demo_slug: str) -> None:
    r = client.post("/api/sessions", json={"slug": demo_slug})
    assert r.status_code == 200
    session_id = r.json()["sessionId"]
    r = client.post(
        f"/api/studies/{demo_slug}/scenarios",
        json={
            "session_id": session_id,
            "name": "pytest_rejected_validation",
            "description": "t",
            "validation": True,
        },
    )
    assert r.status_code == 400
    assert "deprecated" in r.json()["detail"].lower()


def test_validation_scenario_score_api(demo_slug: str) -> None:
    name = "pytest_validation_score"
    _save_legacy_validation_scenario(demo_slug, name)
    r = client.get(
        f"/api/studies/{demo_slug}/validation/score",
        params={"scenario": name},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["scenario"] == name
    if not data["hasAudit"]:
        pytest.skip("Demo_Study has no audit shares")
    assert data["skuCount"] > 0
    assert data["meanAbsDeltaPp"] is not None
    assert data["wmape"] is not None
    assert data["maxAbsDeltaPp"] is not None
    assert data["maxAbsDeltaPp"] >= data["meanAbsDeltaPp"]


def test_validation_scenario_score_rejects_non_validation(demo_slug: str) -> None:
    r = client.post(f"/api/sessions", json={"slug": demo_slug})
    session_id = r.json()["sessionId"]
    name = "pytest_non_validation_score"
    r = client.post(
        f"/api/studies/{demo_slug}/scenarios",
        json={
            "session_id": session_id,
            "name": name,
            "description": "t",
            "validation": False,
        },
    )
    assert r.status_code == 200
    r = client.get(
        f"/api/studies/{demo_slug}/validation/score",
        params={"scenario": name},
    )
    assert r.status_code == 400


def test_validation_score_parity_with_validation_rows(demo_slug: str) -> None:
    name = "pytest_validation_parity"
    _save_legacy_validation_scenario(demo_slug, name)
    project = ProjectCore(demo_slug)
    project.initialize()
    if project.get_total_products_audit_share() <= 0:
        pytest.skip("Demo_Study has no audit shares")

    score = validation_scenario_score(demo_slug, name)
    rows_data = validation_rows(project, level="sku", layout="by_scenario", scenarios=[name])
    rows = rows_data["tables"][0]["rows"]
    deltas_pp = [abs(r["delta"] * 100.0) for r in rows if r["audit"] * 100.0 > 0]
    assert deltas_pp
    expected_mean = sum(deltas_pp) / len(deltas_pp)
    assert abs(score["meanAbsDeltaPp"] - expected_mean) < 1e-3

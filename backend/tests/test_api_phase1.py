"""API integration tests — Phase 1 Simulator endpoints."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from api.main import app

client = TestClient(app)


def test_health() -> None:
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_session_recalculate_with_change(demo_slug: str) -> None:
    r = client.post("/api/sessions", json={"slug": demo_slug})
    assert r.status_code == 200
    payload = r.json()
    session_id = payload["sessionId"]
    assert payload["slug"] == demo_slug
    assert "editableColumns" in payload
    assert len(payload["results"]) > 0

    row = payload["results"][0]
    product = row["Product Name"]
    price_col = next(c for c in payload["editableColumns"] if c.startswith("New "))
    original = row[price_col]

    r2 = client.post(
        f"/api/sessions/{session_id}/recalculate",
        json={"changes": [{"product": product, "column": price_col, "value": original}]},
    )
    assert r2.status_code == 200
    assert "changesApplied" in r2.json()


def test_tier1_groups_and_bounds(demo_slug: str) -> None:
    """Tier 1: productNames, richer group metrics, calibrated attributeBounds."""
    r = client.post("/api/sessions", json={"slug": demo_slug})
    assert r.status_code == 200
    payload = r.json()
    session_id = payload["sessionId"]

    assert "attributeBounds" in payload
    bounds = payload["attributeBounds"]
    assert isinstance(bounds, dict)
    assert len(bounds) > 0
    sample_product = next(iter(bounds))
    assert "Price" in bounds[sample_product]
    assert "WD" in bounds[sample_product]
    price_b = bounds[sample_product]["Price"]
    assert price_b["lo"] < price_b["hi"]
    assert bounds[sample_product]["WD"] == {"lo": 0.0, "hi": 100.0}

    r_bounds = client.get(f"/api/sessions/{session_id}/bounds")
    assert r_bounds.status_code == 200
    assert r_bounds.json()["attributeBounds"][sample_product]["Price"]["lo"] == price_b["lo"]

    groups = payload["groups"]
    if not groups and payload.get("groupTypes"):
        gt = payload["groupTypes"][0]
        r_g = client.get(f"/api/sessions/{session_id}/groups", params={"group_type": gt})
        assert r_g.status_code == 200
        groups = r_g.json()["groups"]

    if not groups:
        pytest.skip("Demo_Study has no groups")

    g0 = groups[0]
    assert "productNames" in g0
    assert isinstance(g0["productNames"], list)
    assert len(g0["productNames"]) > 0
    assert "S.Index" in g0
    assert "R.Index" in g0
    # MM$ only when financial study
    if payload["study"]["financial"]:
        assert "MM$" in g0


def test_segmentation_and_scenario_roundtrip(demo_slug: str) -> None:
    r = client.post("/api/sessions", json={"slug": demo_slug})
    session_id = r.json()["sessionId"]

    r_seg = client.get(f"/api/sessions/{session_id}/segmentation")
    assert r_seg.status_code == 200

    r_save = client.post(
        f"/api/studies/{demo_slug}/scenarios",
        json={
            "session_id": session_id,
            "name": "_pytest_phase1",
            "description": "test",
            "validation": False,
        },
    )
    assert r_save.status_code == 200

    r_list = client.get(f"/api/studies/{demo_slug}/scenarios")
    assert any(s["name"] == "_pytest_phase1" for s in r_list.json())

    client.delete(f"/api/studies/{demo_slug}/scenarios/_pytest_phase1")

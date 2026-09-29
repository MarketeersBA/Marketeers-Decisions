"""Phase 4 — multi-segment AND and analytics API."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from api.main import app
from model.project_core import ProjectCore

client = TestClient(app)


@pytest.fixture
def demo_slug() -> str:
    if not ProjectCore.study_exists("Demo_Study"):
        pytest.skip("Demo_Study not available")
    return "Demo_Study"


def test_multi_segment_and_filtering(demo_slug: str) -> None:
    r = client.post("/api/sessions", json={"slug": demo_slug})
    assert r.status_code == 200
    session_id = r.json()["sessionId"]
    seg = client.get(f"/api/sessions/{session_id}/segmentation").json()
    if len(seg["dimensions"]) < 1:
        pytest.skip("Study has no segmentation dimensions")

    dim = seg["dimensions"][0]
    members = seg["membersByKey"].get(dim["assignmentKey"], [])
    if len(members) < 1:
        pytest.skip("No segment members")

    r1 = client.post(
        f"/api/sessions/{session_id}/segmentation",
        json={
            "filters": [{"assignment_key": dim["assignmentKey"], "member": members[0]}],
        },
    )
    assert r1.status_code == 200
    single_count = r1.json()["study"].get("filteredRespondents")

    if len(seg["dimensions"]) >= 2:
        dim2 = seg["dimensions"][1]
        members2 = seg["membersByKey"].get(dim2["assignmentKey"], [])
        if members2:
            r2 = client.post(
                f"/api/sessions/{session_id}/segmentation",
                json={
                    "filters": [
                        {"assignment_key": dim["assignmentKey"], "member": members[0]},
                        {"assignment_key": dim2["assignmentKey"], "member": members2[0]},
                    ],
                },
            )
            assert r2.status_code == 200
            and_count = r2.json()["study"].get("filteredRespondents")
            if single_count is not None and and_count is not None:
                assert and_count <= single_count
            active = r2.json()["segmentation"]["activeFilters"]
            assert len(active) == 2


def test_analytics_som_sop_endpoint(demo_slug: str) -> None:
    r = client.get(f"/api/studies/{demo_slug}/analytics/som-sop")
    assert r.status_code == 200
    body = r.json()
    assert body["type"] == "som-sop"
    assert isinstance(body["data"], list)
    if body["data"]:
        row = body["data"][0]
        assert "som" in row and "sop" in row


def test_analytics_validation_endpoint(demo_slug: str) -> None:
    r = client.get(f"/api/studies/{demo_slug}/analytics/validation")
    assert r.status_code == 200
    data = r.json()["data"]
    assert isinstance(data, list)
    if data:
        assert "predicted" in data[0] and "audit" in data[0]


def test_analytics_removal_with_current_lineup(demo_slug: str) -> None:
    project = ProjectCore(demo_slug)
    project.initialize()
    model = project._model
    assert model is not None
    names = list(model.company_products) or list(model.all_product_names)
    if len(names) < 2:
        pytest.skip("Need 2+ products")
    lineup = names[:-1]
    candidate = names[-1]
    r = client.get(
        f"/api/studies/{demo_slug}/analytics/removal",
        params={
            "mode": "exclusive",
            "group_type": "Company Products",
            "products": candidate,
            "current_lineup": ",".join(lineup + [candidate]),
            "incremental_type": "Revenue",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["type"] == "removal"
    rows = body["data"]
    assert isinstance(rows, list)
    assert rows
    assert rows[0]["productName"] == "Current"
    product_names = {row["productName"] for row in rows}
    assert candidate in product_names


def test_scenario_multi_segment_roundtrip(demo_slug: str) -> None:
    r = client.post("/api/sessions", json={"slug": demo_slug})
    session_id = r.json()["sessionId"]
    seg = client.get(f"/api/sessions/{session_id}/segmentation").json()
    if not seg["dimensions"]:
        pytest.skip("No segmentation")
    dim = seg["dimensions"][0]
    member = seg["membersByKey"][dim["assignmentKey"]][0]
    client.post(
        f"/api/sessions/{session_id}/segmentation",
        json={"filters": [{"assignment_key": dim["assignmentKey"], "member": member}]},
    )
    name = "_pytest_phase4_seg"
    client.post(
        f"/api/studies/{demo_slug}/scenarios",
        json={"session_id": session_id, "name": name, "description": "t", "validation": False},
    )
    client.post("/api/sessions", json={"slug": demo_slug})
    r2 = client.post("/api/sessions", json={"slug": demo_slug})
    sid2 = r2.json()["sessionId"]
    client.post(f"/api/sessions/{sid2}/apply-scenario", json={"name": name})
    payload = client.get(f"/api/sessions/{sid2}/segmentation").json()
    assert payload["activeFilters"] or payload.get("active")
    client.delete(f"/api/studies/{demo_slug}/scenarios/{name}")

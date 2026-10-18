"""Study data sources API."""

from __future__ import annotations

from fastapi.testclient import TestClient

from api.main import app

client = TestClient(app)


def test_get_study_data_sources(demo_slug: str) -> None:
    r = client.get(f"/api/studies/{demo_slug}/data-sources")
    assert r.status_code == 200
    body = r.json()
    assert "sources" in body
    assert len(body["sources"]) == 3
    ids = {s["id"] for s in body["sources"]}
    assert ids == {"design", "hbu", "unit-costs"}
    for src in body["sources"]:
        assert src["initials"]
        assert src["title"]
        assert src["description"]
        assert "updatedAt" in src
        assert "status" not in src
        assert "statusLabel" not in src


def test_get_study_data_sources_not_found() -> None:
    r = client.get("/api/studies/nonexistent_slug_xyz/data-sources")
    assert r.status_code == 404

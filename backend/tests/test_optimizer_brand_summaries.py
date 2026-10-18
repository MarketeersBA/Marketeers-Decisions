"""Bulk brand-summaries endpoint loads the study once for every brand."""

from __future__ import annotations

from fastapi.testclient import TestClient

from api.main import app

client = TestClient(app)


def test_brand_summaries_matches_per_brand(demo_slug: str) -> None:
    ctx = client.get(f"/api/{demo_slug}/optimizer/context")
    assert ctx.status_code == 200
    body = ctx.json()
    group_type = body["default_group_type"]
    groups: dict[str, list[str]] = body["groups_by_type"][group_type]
    assert groups

    bulk = client.get(
        f"/api/{demo_slug}/optimizer/brand-summaries",
        params={"group_type": group_type},
    )
    assert bulk.status_code == 200
    brands = bulk.json()["brands"]
    assert set(brands) == set(groups)

    sample_brand = next(iter(groups))
    single = client.get(
        f"/api/{demo_slug}/optimizer/brand-summary",
        params={"group_type": group_type, "brand": sample_brand},
    )
    assert single.status_code == 200
    single_names = [s["name"] for s in single.json()["skus"]]
    bulk_names = [s["name"] for s in brands[sample_brand]["skus"]]
    assert bulk_names == single_names
    assert brands[sample_brand]["kpis"]["skus_count"] == single.json()["kpis"]["skus_count"]

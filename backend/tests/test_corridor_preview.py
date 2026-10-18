"""Corridor preview sweep tests."""

from __future__ import annotations

import pytest

from model.corridor_preview import _current_price, _product_id, corridor_preview
from model.optimizer import (
    get_calibrated_bounds,
    get_optimizer_groups,
    get_optimizer_group_types,
)
from model.project_core import ProjectCore


def _explicit_costs(project: ProjectCore, skus: list[str]) -> dict[str, float]:
    """Test-supplied costs. Runtime never invents these."""
    costs: dict[str, float] = {}
    for sku in skus:
        price = _current_price(project, sku) or 1.0
        costs[sku] = round(price * 0.4, 3)
    return costs


def test_corridor_preview_returns_points_and_both_volume_drops(demo_slug: str) -> None:
    project = ProjectCore(demo_slug)
    project.initialize()
    group_types = get_optimizer_group_types(project)
    assert group_types
    group_type = group_types[0]
    groups = get_optimizer_groups(project, group_type)
    assert groups
    brand = next(iter(groups))
    skus = groups[brand]
    assert skus
    reference_sku = skus[0]

    project.find_predicted_shares()
    # Use a synthetic anchor near the reference base price.
    base = _current_price(project, reference_sku) or 1.0
    anchor_price = base

    out = corridor_preview(
        project,
        group_type=group_type,
        brand=brand,
        reference_sku=reference_sku,
        anchor_price=anchor_price,
        anchor_label="Test Anchor",
        index_min=90,
        index_max=110,
        n_points=3,
        min_margin_pct=20.0,
        max_volume_drop_pct=50.0,
        cost_overrides=_explicit_costs(project, skus),
    )

    assert out["reference_sku"] == reference_sku
    assert len(out["points"]) >= 3
    for pt in out["points"]:
        assert "brand_cm_pct" in pt
        assert "ref_sku_cm_pct" in pt
        assert "brand_volume_drop_pct" in pt
        assert "ref_sku_volume_drop_pct" in pt
        assert "ref_sku_volume_index" in pt
        assert "ref_sku_revenue_index" in pt
        assert "ref_sku_margin_index" in pt
        assert "ref_sku_revenue" in pt
        assert "feasible" in pt
    assert out["bounds"]["recommended"] is not None
    assert "definitions" in out
    current = [p for p in out["points"] if p.get("is_current")]
    assert current, "sweep must include today's shelf price"
    assert current[0]["ref_sku_volume_index"] == pytest.approx(100.0, abs=0.05)
    assert current[0]["ref_sku_revenue_index"] == pytest.approx(100.0, abs=0.05)
    assert current[0]["ref_sku_margin_index"] == pytest.approx(100.0, abs=0.05)


def test_corridor_band_is_margin_floor_to_volume_cap(demo_slug: str) -> None:
    """Min is the margin-floor price; max comes from the volume cap or price ceiling."""
    project = ProjectCore(demo_slug)
    project.initialize()
    group_type = get_optimizer_group_types(project)[0]
    groups = get_optimizer_groups(project, group_type)
    brand = next(iter(groups))
    reference_sku = groups[brand][0]

    project.find_predicted_shares()
    anchor_price = _current_price(project, reference_sku) or 1.0

    # Pick a margin floor whose implied price c / (1 - m) lands inside the
    # calibrated range, so the floor actually binds whatever study we ran on.
    pid = _product_id(project, reference_sku)
    assert pid is not None
    price_lo, price_hi = get_calibrated_bounds(project.doc, pid, anchor_price)
    costs = _explicit_costs(project, groups[brand])
    cost = costs[reference_sku]
    if cost <= 0:
        pytest.skip("reference SKU has no usable unit cost")
    target_price = price_lo + (price_hi - price_lo) * 0.35
    min_margin_pct = (1.0 - cost / target_price) * 100.0
    if min_margin_pct <= 0:
        pytest.skip("cost exceeds the calibrated price range, so no floor can bind")

    out = corridor_preview(
        project,
        group_type=group_type,
        brand=brand,
        reference_sku=reference_sku,
        anchor_price=anchor_price,
        n_points=10,
        min_margin_pct=min_margin_pct,
        max_volume_drop_pct=10.0,
        cost_overrides=costs,
    )

    bounds = out["bounds"]
    assert bounds["min_binding_label"] == "min contribution margin"

    floor_price = out["margin_floor_price"]
    assert floor_price is not None
    # Min is the exact margin-floor price, within a cent and never below it.
    assert bounds["min"]["price"] >= floor_price - 1e-9
    assert bounds["min"]["price"] <= floor_price + 0.01 + 1e-9
    assert bounds["min"]["ref_sku_cm_pct"] >= min_margin_pct - 1e-6

    # The margin floor can only cut the cheap end, so the top comes from elsewhere.
    assert bounds["max_binding_label"] in {"max volume drop", "calibrated price ceiling"}
    assert bounds["max"]["price"] >= bounds["min"]["price"] - 1e-9
    assert bounds["max"]["brand_volume_drop_pct"] <= 10.0 + 1e-9

    # Recommended is the best contribution in-band, so it beats both edges.
    rec = bounds["recommended"]["ref_sku_contribution"]
    assert rec >= bounds["min"]["ref_sku_contribution"] - 1e-6
    assert rec >= bounds["max"]["ref_sku_contribution"] - 1e-6
    assert bounds["min"]["price"] - 1e-9 <= bounds["recommended"]["price"]
    assert bounds["recommended"]["price"] <= bounds["max"]["price"] + 1e-9


def test_tighter_margin_floor_never_widens_the_corridor(demo_slug: str) -> None:
    """Loosening a guardrail must not shrink the band (the old rule inverted this)."""
    project = ProjectCore(demo_slug)
    project.initialize()
    group_type = get_optimizer_group_types(project)[0]
    groups = get_optimizer_groups(project, group_type)
    brand = next(iter(groups))
    reference_sku = groups[brand][0]

    project.find_predicted_shares()
    anchor_price = _current_price(project, reference_sku) or 1.0

    widths: list[float] = []
    for min_margin_pct in (20.0, 30.0, 40.0):
        out = corridor_preview(
            project,
            group_type=group_type,
            brand=brand,
            reference_sku=reference_sku,
            anchor_price=anchor_price,
            n_points=6,
            min_margin_pct=min_margin_pct,
            max_volume_drop_pct=10.0,
            cost_overrides=_explicit_costs(project, groups[brand]),
        )
        bounds = out["bounds"]
        if bounds["min_binding_label"] == "infeasible":
            continue
        widths.append(bounds["max"]["price"] - bounds["min"]["price"])

    if len(widths) < 2:
        pytest.skip("not enough binding margin floors to compare corridor widths")
    for looser, tighter in zip(widths, widths[1:]):
        assert tighter <= looser + 1e-9

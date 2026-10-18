"""Corridor preview — reference-SKU price sweep vs a competitive anchor.

Used by the Optimizer before-run chart: reference-SKU volume / revenue /
margin response curves and min / recommended / max price points under guardrails.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING

from data.unit_costs import stored_unit_costs, unit_cost_gap_message, unit_cost_provenance
from model.optimizer import (
    _margin_floor_price,
    get_calibrated_bounds,
    get_optimizer_groups,
)

if TYPE_CHECKING:
    from model.project_core import ProjectCore

# Each step re-solves predicted shares, so keep the volume-cap search short.
_BISECT_ITERS = 12
# Resolution of the in-band contribution scan that picks the recommended price.
_SCAN_POINTS = 24


@dataclass
class _SkuSnap:
    name: str
    price: float
    volume: float  # NewShare units (typically 0–100 scale)
    revenue: float
    cost: float | None

    @property
    def unit_cm_pct(self) -> float | None:
        if self.price <= 0 or self.cost is None or self.cost < 0:
            return None
        return (self.price - self.cost) / self.price * 100.0

    @property
    def contribution(self) -> float:
        """€ contribution proxy: revenue × unit margin."""
        cm = self.unit_cm_pct
        if cm is None or self.revenue <= 0:
            return 0.0
        return self.revenue * (cm / 100.0)


def _current_price(project: "ProjectCore", sku: str) -> float:
    model = project._model
    if model is None:
        return 0.0
    p = model.get_product(sku)
    if p is None:
        return 0.0
    raw = p.new_attributes.get("Price", p.base_attributes.get("Price", 0.0))
    try:
        val = float(raw or 0.0)
        return val if val > 0 else 0.0
    except (TypeError, ValueError):
        return 0.0


def _snap_sku(project: "ProjectCore", sku: str, cost: float | None) -> _SkuSnap:
    price = _current_price(project, sku)
    volume = float(project.get_product_share("NewShare", sku) or 0.0)
    revenue = float(project.get_product_revenue(sku) or 0.0)
    if revenue <= 0 and price > 0 and volume > 0:
        # Fallback when financial/revenue columns are empty: price × share proxy.
        revenue = price * volume
    return _SkuSnap(name=sku, price=price, volume=volume, revenue=revenue, cost=cost)


def _brand_totals(snaps: list[_SkuSnap]) -> dict[str, float]:
    vol = sum(s.volume for s in snaps)
    rev = sum(s.revenue for s in snaps)
    priced = [s for s in snaps if s.cost is not None]
    priced_rev = sum(s.revenue for s in priced)
    contrib = sum(s.contribution for s in priced)
    cm_pct = (contrib / priced_rev * 100.0) if priced_rev > 0 else 0.0
    return {
        "volume": vol,
        "revenue": rev,
        "contribution": contrib,
        "cm_pct": cm_pct,
    }


def _vol_drop_pct(base: float, new: float) -> float:
    """Positive => volume lost vs baseline; negative => volume gained."""
    if base <= 0:
        return 0.0
    return (base - new) / base * 100.0


def _index_vs_base(new: float, base: float) -> float:
    """Index vs today's shelf price: 100 = baseline."""
    if base <= 0:
        return 0.0
    return new / base * 100.0


def _product_id(project: "ProjectCore", sku: str) -> int | None:
    model = project._model
    if model is None:
        return None
    p = model.get_product(sku)
    return p.product_id if p is not None else None


def _index_grid_from_price_bounds(
    *,
    price_lo: float,
    price_hi: float,
    anchor_price: float,
    index_step: float | None = None,
    n_points: int = 10,
) -> tuple[float, float, list[float]]:
    """Build an index grid whose pack prices stay inside [price_lo, price_hi].

    Prefer ``n_points`` evenly spaced indexes (default 10). If ``index_step`` is
    set, use a fixed step grid instead (and still include calibrated endpoints).
    """
    raw_min = price_lo / anchor_price * 100.0
    raw_max = price_hi / anchor_price * 100.0
    if raw_max < raw_min:
        raw_min, raw_max = raw_max, raw_min

    if index_step is not None and index_step > 0:
        first = math.ceil(raw_min / index_step - 1e-12) * index_step
        last = math.floor(raw_max / index_step + 1e-12) * index_step
        indexes: list[float] = []
        if first <= last + 1e-12:
            idx = first
            while idx <= last + 1e-9:
                indexes.append(round(idx, 6))
                idx += index_step
        else:
            indexes = [round(raw_min, 6), round(raw_max, 6)]
            if abs(indexes[0] - indexes[1]) < 1e-9:
                indexes = [indexes[0]]
        for edge in (raw_min, raw_max):
            edge_r = round(edge, 6)
            if all(abs(edge_r - i) > 1e-6 for i in indexes):
                indexes.append(edge_r)
        indexes.sort()
        return indexes[0], indexes[-1], indexes

    n = max(2, int(n_points))
    if abs(raw_max - raw_min) < 1e-12:
        return raw_min, raw_max, [round(raw_min, 6)]
    indexes = [
        round(raw_min + (raw_max - raw_min) * i / (n - 1), 6) for i in range(n)
    ]
    return indexes[0], indexes[-1], indexes


def corridor_preview(
    project: "ProjectCore",
    *,
    group_type: str,
    brand: str,
    reference_sku: str,
    anchor_price: float,
    anchor_label: str | None = None,
    anchor_sku: str | None = None,
    index_min: float | None = None,
    index_max: float | None = None,
    index_step: float | None = None,
    n_points: int = 10,
    min_margin_pct: float | None = None,
    max_volume_drop_pct: float | None = None,
    cost_overrides: dict[str, float] | None = None,
) -> dict:
    """Sweep focus reference SKU price as an index of ``anchor_price``.

    When ``index_min`` / ``index_max`` are omitted, the sweep spans the reference
    SKU's calibrated Price attribute bounds (study conditional levels), expressed
    as an index of the anchor. By default the axis uses ``n_points`` evenly spaced
    samples (10). Pass ``index_step`` to use a fixed step grid instead.

    Parameters
    ----------
    min_margin_pct:
        Unit-margin floor as a **percent** (e.g. ``34`` for 34%), applied to the
        reference SKU for feasibility (aligns with solver ``min_margin_pct`` once
        converted to a fraction on Run).
    max_volume_drop_pct:
        Max allowed **brand** volume drop as a percent (e.g. ``10`` for 10%).
    """
    if anchor_price <= 0:
        raise ValueError("anchor_price must be > 0")
    if index_step is not None and index_step <= 0:
        raise ValueError("index_step must be > 0")
    if n_points < 2:
        raise ValueError("n_points must be >= 2")

    brand_skus = get_optimizer_groups(project, group_type).get(brand, [])
    if not brand_skus:
        raise ValueError(f"No SKUs for brand {brand!r} in group type {group_type!r}")
    if reference_sku not in brand_skus:
        raise ValueError(
            f"reference_sku {reference_sku!r} is not in focus brand {brand!r}"
        )

    stored = cost_overrides if cost_overrides is not None else stored_unit_costs(project.doc)
    costs = {sku: stored.get(sku) for sku in brand_skus}
    missing = [sku for sku, cost in costs.items() if cost is None]

    project.find_predicted_shares()
    base_snaps = [_snap_sku(project, sku, costs[sku]) for sku in brand_skus]
    base_by_name = {s.name: s for s in base_snaps}
    base_brand = _brand_totals(base_snaps)
    base_ref = base_by_name[reference_sku]
    restore_price = base_ref.price

    pid = _product_id(project, reference_sku)
    if project.doc is None or pid is None:
        raise ValueError(f"Cannot resolve calibrated bounds for {reference_sku!r}")
    price_lo, price_hi = get_calibrated_bounds(project.doc, pid, base_ref.price or anchor_price)
    if price_lo <= 0 or price_hi <= 0 or price_hi < price_lo:
        raise ValueError(
            f"Invalid calibrated price bounds for {reference_sku!r}: [{price_lo}, {price_hi}]"
        )

    index_range_source = "calibrated_price_bounds"
    resolved_step: float | None = float(index_step) if index_step is not None else None
    if index_min is None or index_max is None:
        auto_min, auto_max, indexes = _index_grid_from_price_bounds(
            price_lo=price_lo,
            price_hi=price_hi,
            anchor_price=anchor_price,
            index_step=resolved_step,
            n_points=n_points,
        )
        resolved_min = float(index_min) if index_min is not None else auto_min
        resolved_max = float(index_max) if index_max is not None else auto_max
        if index_min is not None or index_max is not None:
            if resolved_max < resolved_min:
                raise ValueError("index_max must be >= index_min")
            if resolved_step is not None:
                indexes = []
                idx = resolved_min
                while idx <= resolved_max + 1e-9:
                    indexes.append(round(idx, 6))
                    idx += resolved_step
            else:
                indexes = [
                    round(
                        resolved_min
                        + (resolved_max - resolved_min) * i / (n_points - 1),
                        6,
                    )
                    for i in range(n_points)
                ]
            index_range_source = "mixed_explicit_and_calibrated"
        else:
            resolved_min, resolved_max = auto_min, auto_max
            if resolved_step is None and len(indexes) >= 2:
                resolved_step = (resolved_max - resolved_min) / (len(indexes) - 1)
    else:
        resolved_min = float(index_min)
        resolved_max = float(index_max)
        if resolved_max < resolved_min:
            raise ValueError("index_max must be >= index_min")
        if resolved_step is not None:
            indexes = []
            idx = resolved_min
            while idx <= resolved_max + 1e-9:
                indexes.append(round(idx, 6))
                idx += resolved_step
        else:
            indexes = [
                round(
                    resolved_min + (resolved_max - resolved_min) * i / (n_points - 1),
                    6,
                )
                for i in range(n_points)
            ]
            resolved_step = (resolved_max - resolved_min) / (n_points - 1)
        index_range_source = "explicit"

    cache: dict[float, dict] = {}

    def _evaluate(price: float, *, index: float | None = None) -> dict:
        # Never evaluate outside the study's calibrated Price grid.
        price = round(min(max(price, price_lo), price_hi), 4)
        cached = cache.get(price)
        if cached is not None:
            return cached

        idx = index if index is not None else price / anchor_price * 100.0
        project.change_product_attribute(reference_sku, "Price", str(price))
        project.find_predicted_shares()

        snaps = [_snap_sku(project, sku, costs[sku]) for sku in brand_skus]
        by_name = {s.name: s for s in snaps}
        ref = by_name[reference_sku]
        brand_tot = _brand_totals(snaps)

        sku_vol_drop = _vol_drop_pct(base_ref.volume, ref.volume)
        brand_vol_drop = _vol_drop_pct(base_brand["volume"], brand_tot["volume"])
        ref_cm = ref.unit_cm_pct
        ref_contrib = ref.contribution
        ref_contrib_idx = _index_vs_base(ref_contrib, base_ref.contribution)
        ref_vol_idx = _index_vs_base(ref.volume, base_ref.volume)
        ref_rev_idx = _index_vs_base(ref.revenue, base_ref.revenue)
        brand_contrib = brand_tot["contribution"]
        brand_contrib_idx = _index_vs_base(brand_contrib, base_brand["contribution"])

        cm_ok = True
        if min_margin_pct is not None:
            cm_ok = ref_cm is not None and ref_cm + 1e-9 >= float(min_margin_pct)

        vol_ok = True
        if max_volume_drop_pct is not None:
            vol_ok = brand_vol_drop <= float(max_volume_drop_pct) + 1e-9

        pt = {
            "index": round(idx, 6),
            "price": price,
            "ref_sku_cm_pct": ref_cm,
            "ref_sku_contribution": ref_contrib,
            "ref_sku_contribution_index": ref_contrib_idx,
            "ref_sku_revenue": ref.revenue,
            "ref_sku_volume_index": ref_vol_idx,
            "ref_sku_revenue_index": ref_rev_idx,
            "ref_sku_margin_index": ref_contrib_idx,
            "brand_cm_pct": brand_tot["cm_pct"],
            "brand_contribution": brand_contrib,
            "brand_contribution_index": brand_contrib_idx,
            "ref_sku_volume": ref.volume,
            "brand_volume": brand_tot["volume"],
            "ref_sku_volume_drop_pct": sku_vol_drop,
            "brand_volume_drop_pct": brand_vol_drop,
            "feasible": bool(cm_ok and vol_ok),
            "cm_ok": bool(cm_ok),
            "vol_ok": bool(vol_ok),
        }
        # Today's shelf price is the index origin: all three indexes = 100.
        if restore_price > 0 and abs(price - restore_price) <= 5e-3:
            pt["ref_sku_volume_index"] = 100.0
            pt["ref_sku_revenue_index"] = 100.0
            pt["ref_sku_margin_index"] = 100.0
            pt["ref_sku_contribution_index"] = 100.0
            pt["is_current"] = True
        else:
            pt["is_current"] = False
        cache[price] = pt
        return pt

    def _bisect_last_ok(lo_pt: dict, hi_pt: dict, ok: Callable[[dict], bool]) -> dict:
        """Highest price still satisfying ``ok``; ``lo_pt`` passes, ``hi_pt`` fails."""
        lo, hi = lo_pt["price"], hi_pt["price"]
        best = lo_pt
        tol = max(0.005, (price_hi - price_lo) * 1e-3)
        for _ in range(_BISECT_ITERS):
            if hi - lo <= tol:
                break
            mid = (lo + hi) / 2.0
            pt = _evaluate(mid)
            if ok(pt):
                lo, best = mid, pt
            else:
                hi = mid
        return best

    def _best_contribution(lo: float, hi: float) -> dict:
        """Highest ref-SKU contribution in ``[lo, hi]``, found by dense scan.

        Share responds to price in steps, so contribution is jagged and can carry
        several local peaks — scanning avoids assuming a single smooth hump.
        """
        if hi - lo <= 0.01:
            return _evaluate(lo)
        step = max(0.01, (hi - lo) / _SCAN_POINTS)
        prices = [lo + step * k for k in range(int((hi - lo) / step) + 1)]
        if prices[-1] < hi - 1e-9:
            prices.append(hi)
        return max(
            (_evaluate(p) for p in prices),
            key=lambda p: p["ref_sku_contribution"],
        )

    # Lowest price whose ref-SKU unit CM clears the margin floor, solved from
    # CM% = (p - c) / p × 100  =>  p = c / (1 - floor).
    margin_floor_price = price_lo
    min_binding_label = "calibrated price floor"
    if min_margin_pct is not None:
        floor_frac = float(min_margin_pct) / 100.0
        ref_cost = costs.get(reference_sku)
        if ref_cost is None:
            raise ValueError(unit_cost_gap_message([reference_sku]))
        if ref_cost > 0 and floor_frac >= 1.0 - 1e-12:
            margin_floor_price = math.inf  # no price clears a 100% margin floor
        else:
            solved = _margin_floor_price(ref_cost, floor_frac)
            if solved is not None:
                margin_floor_price = solved
        if margin_floor_price > price_lo + 1e-12:
            min_binding_label = "min contribution margin"
    min_price = max(price_lo, margin_floor_price)
    if math.isfinite(min_price):
        # Round up to the cent so the quoted min price genuinely clears the floor.
        min_price = math.ceil(min_price * 100.0 - 1e-9) / 100.0

    points: list[dict] = []
    min_pt: dict | None = None
    max_pt: dict | None = None
    rec_pt: dict | None = None
    max_binding_label = "calibrated price ceiling"
    try:
        for index in indexes:
            points.append(_evaluate(anchor_price * index / 100.0, index=index))

        # Always sample today's shelf price so Volume / Revenue / Margin Ix
        # meet at 100 (the index origin). The even grid vs the anchor can miss it.
        if restore_price > 0 and price_lo - 1e-9 <= restore_price <= price_hi + 1e-9:
            current_pt = _evaluate(restore_price)
            if all(abs(p["price"] - current_pt["price"]) > 5e-3 for p in points):
                points.append(current_pt)
                points.sort(key=lambda p: p["price"])

        if min_price <= price_hi + 1e-9:
            candidate_min = _evaluate(min_price)
            if candidate_min["cm_ok"] and candidate_min["vol_ok"]:
                # The margin floor only ever cuts off the cheap end — CM% rises
                # with price — so the top of the band comes from the brand volume
                # cap, or the calibrated ceiling when the cap never bites.
                min_pt = candidate_min
                ceiling = _evaluate(price_hi)
                if ceiling["vol_ok"]:
                    max_pt = ceiling
                else:
                    max_pt = _bisect_last_ok(min_pt, ceiling, lambda p: p["vol_ok"])
                    max_binding_label = "max volume drop"
                rec_pt = _best_contribution(min_pt["price"], max_pt["price"])

        extras: list[dict] = []
        if (
            math.isfinite(margin_floor_price)
            and price_lo - 1e-9 <= margin_floor_price <= price_hi + 1e-9
        ):
            extras.append(
                _evaluate(math.ceil(margin_floor_price * 100.0 - 1e-9) / 100.0)
            )
        if max_pt is not None and max_binding_label == "max volume drop":
            extras.append(max_pt)
        for extra_pt in extras:
            if all(abs(p["price"] - extra_pt["price"]) > 5e-3 for p in points):
                points.append(extra_pt)
        points.sort(key=lambda p: p["price"])
    finally:
        if restore_price > 0:
            project.change_product_attribute(reference_sku, "Price", str(restore_price))
            project.find_predicted_shares()

    warnings: list[str] = []
    if missing:
        warnings.append(unit_cost_gap_message(missing))
    if base_ref.volume <= 1e-9:
        warnings.append(
            f"Reference SKU {reference_sku!r} has ~0 baseline volume share, so the contribution "
            "and volume-drop curves will look flat when sweeping its price. Pick a reference "
            "SKU with meaningful share, or check that the SKU is included."
        )
    elif points:
        vol_span = max(abs(p["brand_volume_drop_pct"]) for p in points)
        if vol_span < 1e-6:
            warnings.append(
                "Price sweep produced no brand volume response (all volume drops ≈ 0). "
                "The reference SKU may be excluded, have zero WD, or negligible share."
            )
    if price_lo > 0 and anchor_price > 0:
        mid_index = ((price_lo + price_hi) / 2) / anchor_price * 100.0
        if mid_index < 50 or mid_index > 200:
            warnings.append(
                f"Anchor pack price and reference calibrated prices imply indexes around "
                f"{mid_index:.0f} (parity=100). Pack sizes may be mismatched "
                f"(e.g. 1Kg vs 400g); consider a same-size anchor or unit-basis corridor."
            )

    feasible = [p for p in points if p["feasible"]]

    if rec_pt is None and points:
        # No feasible window — still return a clipped suggestion at the least-bad point.
        def _penalty(p: dict) -> tuple:
            cm_gap = 0.0
            if min_margin_pct is not None and p["ref_sku_cm_pct"] is not None:
                cm_gap = max(0.0, float(min_margin_pct) - p["ref_sku_cm_pct"])
            vol_gap = 0.0
            if max_volume_drop_pct is not None:
                vol_gap = max(0.0, p["brand_volume_drop_pct"] - float(max_volume_drop_pct))
            return (cm_gap + vol_gap, -p["ref_sku_contribution"])

        rec_pt = min(points, key=_penalty)
        min_binding_label = max_binding_label = "infeasible"
        min_pt = max_pt = rec_pt

    def _bound_payload(pt: dict | None) -> dict | None:
        if pt is None:
            return None
        return {
            "index": pt["index"],
            "price": pt["price"],
            "brand_cm_pct": pt["brand_cm_pct"],
            "ref_sku_cm_pct": pt["ref_sku_cm_pct"],
            "ref_sku_contribution": pt["ref_sku_contribution"],
            "ref_sku_contribution_index": pt["ref_sku_contribution_index"],
            "brand_volume_drop_pct": pt["brand_volume_drop_pct"],
            "ref_sku_volume_drop_pct": pt["ref_sku_volume_drop_pct"],
            "brand_contribution": pt["brand_contribution"],
        }

    return {
        "group_type": group_type,
        "brand": brand,
        "reference_sku": reference_sku,
        "anchor_label": anchor_label,
        "anchor_sku": anchor_sku,
        "anchor_price": anchor_price,
        "index_min": resolved_min,
        "index_max": resolved_max,
        "index_step": resolved_step,
        "n_points": len(indexes),
        "index_range_source": index_range_source,
        "calibrated_price_lo": price_lo,
        "calibrated_price_hi": price_hi,
        "min_margin_pct": min_margin_pct,
        "max_volume_drop_pct": max_volume_drop_pct,
        "costs_source": (
            "caller override"
            if cost_overrides is not None
            else unit_cost_provenance(project.doc)
        ),
        "baseline": {
            "reference_sku_price": base_ref.price,
            "reference_sku_volume": base_ref.volume,
            "reference_sku_revenue": base_ref.revenue,
            "reference_sku_cm_pct": base_ref.unit_cm_pct,
            "reference_sku_contribution": base_ref.contribution,
            "brand_volume": base_brand["volume"],
            "brand_cm_pct": base_brand["cm_pct"],
            "brand_contribution": base_brand["contribution"],
            "brand_revenue": base_brand["revenue"],
        },
        "points": points,
        "warnings": warnings,
        "margin_floor_price": (
            margin_floor_price if math.isfinite(margin_floor_price) else None
        ),
        "bounds": {
            "min": _bound_payload(min_pt),
            "max": _bound_payload(max_pt),
            "recommended": _bound_payload(rec_pt),
            "min_binding_label": min_binding_label,
            "max_binding_label": max_binding_label,
            "binding_label": max_binding_label,
            "feasible_count": len(feasible),
        },
        "definitions": {
            "price": "reference_sku price = anchor_price × index / 100, clamped to calibrated Price lo/hi",
            "index_range": (
                "default: n_points (10) evenly spaced across reference SKU calibrated "
                "Price bounds vs anchor; optional index_step for a fixed step grid; "
                "optional explicit index_min/index_max override"
            ),
            "ref_sku_cm_pct": "(p - cost) / p × 100 for the reference SKU",
            "brand_cm_pct": "Σ contribution / Σ revenue over focus-brand SKUs × 100",
            "brand_contribution": "Σ revenue_i × (p_i - c_i) / p_i",
            "ref_sku_volume_drop_pct": "(base_vol - new_vol) / base_vol × 100 for reference SKU",
            "brand_volume_drop_pct": "same formula on sum of focus-brand NewShare",
            "ref_sku_contribution": "ref SKU volume × (p - cost); read to pick a price in-band",
            "ref_sku_contribution_index": "ref_sku_contribution vs baseline × 100 (today = 100)",
            "ref_sku_volume_index": "ref SKU volume vs baseline × 100 (base shelf price = 100)",
            "ref_sku_revenue_index": "ref SKU revenue vs baseline × 100 (base shelf price = 100)",
            "ref_sku_margin_index": "same as ref_sku_contribution_index (sales-margin $ vs baseline)",
            "feasible": (
                "ref_sku_cm_pct ≥ min_margin_pct AND brand_volume_drop_pct ≤ max_volume_drop_pct"
            ),
            "bounds_min": (
                "the margin-floor price cost / (1 - min_margin_pct/100), clamped up to the "
                "calibrated price floor — CM% rises with price, so the floor only cuts the cheap end"
            ),
            "bounds_max": (
                "the price where brand_volume_drop_pct meets max_volume_drop_pct, or the "
                "calibrated price ceiling when the cap never bites"
            ),
            "recommended": (
                "highest ref_sku_contribution over a dense scan of the band; no assumption "
                "that the curve has a single peak"
            ),
        },
    }

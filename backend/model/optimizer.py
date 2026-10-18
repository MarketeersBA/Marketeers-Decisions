"""Brand SKU price optimizer driven by the market simulation engine (black box)."""

from __future__ import annotations

import logging
import math
import warnings
from dataclasses import dataclass, field
from typing import Callable, TypeGuard

import numpy as np

from model.project_core import ProjectCore
from model.study_schema import StudyDocument

logger = logging.getLogger(__name__)


# ── study data helpers ───────────────────────────────────────────────────────

def get_all_group_types(doc: StudyDocument) -> list[str]:
    return sorted({g.group_type for g in doc.groups})


def get_groups_by_type(doc: StudyDocument, group_type: str) -> dict[str, list[str]]:
    return {
        g.group_name: sort_skus_by_size(doc, g.product_names)
        for g in doc.groups
        if g.group_type == group_type
    }


def get_sku_size(doc: StudyDocument, sku: str) -> float | None:
    """Numeric value of the study's configured size attribute for one SKU, or None."""
    product = next((p for p in doc.products if p.name == sku), None)
    if product is None:
        return None
    size_attr = doc.meta.size_attribute
    try:
        size = float(product.base_attributes.get(size_attr))
    except (TypeError, ValueError):
        return None
    return size if math.isfinite(size) and size > 0 else None


def sort_skus_by_size(doc: StudyDocument, skus: list[str]) -> list[str]:
    """Sort SKUs by numeric size, then name; preserve source order when no size exists."""
    products = {p.name: p for p in doc.products}
    size_attr = doc.meta.size_attribute
    sizes: dict[str, float] = {}
    for sku in skus:
        product = products.get(sku)
        if product is None:
            continue
        try:
            size = float(product.base_attributes.get(size_attr))
        except (TypeError, ValueError):
            continue
        if math.isfinite(size) and size > 0:
            sizes[sku] = size

    if not sizes:
        return list(skus)

    return sorted(
        skus,
        key=lambda sku: (
            0 if sku in sizes else 1,
            sizes.get(sku, math.inf),
            sku.casefold(),
        ),
    )


_FALLBACK_GROUP_TYPE = "Brand"
_FALLBACK_BRAND_NAME = "Company Products"


def get_optimizer_group_types(project: ProjectCore) -> list[str]:
    """All group types for the optimizer UI, with brand-related types listed first."""
    doc = project.doc
    if doc is None:
        return []
    group_types = get_all_group_types(doc)
    if not group_types:
        return [_FALLBACK_GROUP_TYPE]
    brand_types = sorted(t for t in group_types if "brand" in t.lower())
    other_types = sorted(t for t in group_types if t not in brand_types)
    return brand_types + other_types if brand_types else group_types


def get_optimizer_groups(project: ProjectCore, group_type: str) -> dict[str, list[str]]:
    """Brand → SKU list for optimizer; falls back to company products when study has no groups."""
    doc = project.doc
    if doc is None:
        return {}
    groups = get_groups_by_type(doc, group_type)
    if groups:
        return groups
    products = project.company_products or project.all_products
    if not products:
        return {}
    return {_FALLBACK_BRAND_NAME: sort_skus_by_size(doc, products)}


def build_optimizer_context(project: ProjectCore) -> dict:
    group_types = get_optimizer_group_types(project)
    groups_by_type = {gt: get_optimizer_groups(project, gt) for gt in group_types}
    default_group_type = group_types[0] if group_types else ""
    doc = project.doc
    has_study_groups = bool(doc and doc.groups)
    return {
        "group_types": group_types,
        "groups_by_type": groups_by_type,
        "groups": groups_by_type.get(default_group_type, {}),
        "default_group_type": default_group_type,
        "uses_fallback_groups": not has_study_groups,
    }


def apply_competitor_price_moves(
    project: ProjectCore,
    group_type: str,
    moves: list,
    skip_brands: set[str] | None = None,
) -> int:
    """Scale competitor-brand SKU prices. This market is the optimizer starting point.

    ``moves`` items are objects or dicts with ``brand`` and ``pct`` (e.g. 5 = +5%).
    Zero / missing moves are ignored. Returns the number of SKUs whose price changed.
    """
    if not moves:
        return 0
    model = project._model
    if model is None:
        return 0
    groups = get_optimizer_groups(project, group_type)
    skip = {b.casefold() for b in (skip_brands or ()) if b}
    changed = 0
    for move in moves:
        if hasattr(move, "brand"):
            brand = str(getattr(move, "brand", "") or "")
            pct = float(getattr(move, "pct", 0) or 0)
        else:
            brand = str(move.get("brand") or "")
            pct = float(move.get("pct") or 0)
        if not brand or abs(pct) < 1e-12:
            continue
        if brand.casefold() in skip:
            continue
        factor = 1.0 + pct / 100.0
        if factor <= 0:
            continue
        for sku in groups.get(brand, []):
            product = model.get_product(sku)
            if product is None:
                continue
            raw = product.new_attributes.get(
                "Price", product.base_attributes.get("Price", 0.0)
            )
            try:
                price = float(raw or 0.0)
            except (TypeError, ValueError):
                continue
            if price <= 0:
                continue
            project._attr_engine.change(model, sku, "Price", str(price * factor))
            changed += 1
    if changed:
        project.reload_results()
    return changed


def get_calibrated_bounds(
    doc: StudyDocument, product_id: int, base_price: float
) -> tuple[float, float]:
    """Return [lo, hi] from Price Attribute Levels only; else ±40% of base with a warning.

    Does not use other conditional grids (e.g. Size) when Price levels are missing.
    """
    price_rows = [
        r
        for r in doc.conditional_levels
        if r.product_id == product_id
        and ((r.attribute_name or "").strip().lower() == "price")
    ]
    if price_rows:
        best = max(price_rows, key=lambda r: len(r.levels))
        vals = []
        for v in best.levels.values():
            try:
                fv = float(v)
                if fv > 0:
                    vals.append(fv)
            except (TypeError, ValueError):
                pass
        if len(vals) >= 2:
            return float(min(vals)), float(max(vals))

    product_name = next(
        (p.name for p in doc.products if p.product_id == product_id),
        f"product_id={product_id}",
    )
    msg = (
        f"No Price Attribute Levels for {product_name!r}; "
        f"using ±40% of base price ({base_price:g}) for calibrated bounds"
    )
    warnings.warn(msg, UserWarning, stacklevel=2)
    logger.warning(msg)
    lo = max(base_price * 0.6, 0.01)
    hi = base_price * 1.4
    return lo, hi


def estimate_evals(spec: "OptSpec") -> int:
    """Rough upper-bound on evaluation count (for progress bar scaling)."""
    n = len(spec.bounds)
    return spec.max_iters * n * 15 + n * 25 + 5


# ── data structures ──────────────────────────────────────────────────────────

@dataclass
class PriceBound:
    sku: str
    base_price: float
    lo: float
    hi: float
    cost: float | None = None


@dataclass
class OptSpec:
    bounds: list[PriceBound]
    objective: str          # "revenue" | "value_share" | "volume_share" | "margin"
    scope_skus: list[str]   # objective is aggregated over these SKUs (whole brand)
    max_iters: int = 15
    multi_start: str = "full"  # "full" | "current" — full = 5 starts; current = base prices only
    tol: float = 1e-5
    max_volume_drop_pct: float | None = None  # None = off; max brand volume drop vs baseline (%)
    baseline_brand_volume: float | None = None  # sum of scope NewShare at baseline; set on first eval

    # ── reference SKU / competitive anchor / price corridor ─────────────────
    reference_sku: str | None = None       # our decision SKU being positioned
    anchor_label: str | None = None        # display label for the competitor/benchmark
    anchor_price: float | None = None      # fixed competitor (or index) price snapshot
    corridor_basis: str = "pack"           # "pack" | "unit"
    corridor_min: float | None = None      # min allowed reference/anchor ratio
    corridor_max: float | None = None      # max allowed reference/anchor ratio
    reference_size: float | None = None    # unit size for reference SKU (unit-basis corridor)
    anchor_size: float | None = None       # unit size for anchor (unit-basis corridor)

    # ── Pack Price Architecture (size ladder) ────────────────────────────────
    ppa_size_chains: list[list[str]] = field(default_factory=list)  # decision SKUs, small → large
    ppa_tier_links: list[dict] = field(default_factory=list)  # tier links between sizes
    ppa_sizes: dict[str, float] = field(default_factory=dict)  # sku -> unit size
    ppa_min_saving: float | None = None    # min €/unit saving fraction moving up a size
    ppa_max_saving: float | None = None    # max €/unit saving fraction moving up a size

    # ── margin / movement / shelf-price snap ─────────────────────────────────
    min_margin_pct: float | None = None          # e.g. 0.30 → never below 30% margin
    unit_costs: dict[str, float] = field(default_factory=dict)


@dataclass
class OptResult:
    prices: dict[str, float]
    objective_value: float
    baseline_value: float
    n_evals: int
    obj_history: list[float] = field(default_factory=list)
    sweep_data: dict | None = None  # {prices, values, sku, optimal} – for 1-SKU chart
    baseline_brand_volume: float = 0.0
    final_brand_volume: float = 0.0
    brand_volume_drop_pct: float = 0.0
    max_volume_drop_pct: float | None = None
    corridor_ratio: float | None = None
    binding_constraints: list[str] = field(default_factory=list)
    infeasible_trials: int = 0
    base_prices_violate_constraints: bool = False
    # optimal_found | feasible | infeasible | error
    solution_status: str = "optimal_found"
    constraint_conflicts: list[str] = field(default_factory=list)
    # Per-SKU "why this price" + ladder diagnostic + run diagnostics
    limited_by: dict[str, str] = field(default_factory=dict)
    ppa_ladder_rows: list[dict] = field(default_factory=list)
    raw_prices: dict[str, float] = field(default_factory=dict)
    duration_ms: float | None = None
    n_passes: int = 0
    menus: dict[str, list[float]] | None = None

    @property
    def uplift_pct(self) -> float:
        if self.baseline_value == 0:
            return 0.0
        return (self.objective_value - self.baseline_value) / abs(self.baseline_value) * 100.0


class ConstraintSetupError(ValueError):
    """Raised when PPA/corridor setup is incomplete or the feasible set is empty."""

    def __init__(self, messages: list[str]):
        self.messages = messages
        super().__init__("; ".join(messages))


# ── engine interface ─────────────────────────────────────────────────────────

def _fast_pipeline(model) -> None:
    """Run only the new-preference → share → metrics path.

    Assumes base_preference_share / base_revenue / base_value_sales_unit are
    already populated (they are, after ProjectCore.initialize()).  Skips the
    redundant base-preference re-computation that reload_results() would trigger,
    giving ~3× fewer compute_preference_shares calls per evaluation.
    """
    from model.preference_engine import compute_preference_shares
    from model.share_calculator import calculate_new_shares
    from model import metrics as _metrics

    # Reset current state to base (mirrors what _run_pipeline does)
    for p in model.products:
        p.current_share = p.base_share
        p.current_preference_share = p.base_preference_share

    # Only compute NEW preference shares — base is already correct
    new_pref = compute_preference_shares(model, use_new_attributes=True)
    for p in model.products:
        p.new_preference_share = new_pref.get(p.name, 0.0)

    calculate_new_shares(model)
    _metrics.apply_scenario_metrics(model)


def _set_prices(project: ProjectCore, prices: dict[str, float]) -> None:
    """Apply all prices in one batch then run the fast pipeline (no DataFrame build)."""
    model = project._model
    if model is None:
        return
    ae = project._attr_engine
    for sku, price in prices.items():
        ae.change(model, sku, "Price", str(price))
    _fast_pipeline(model)


def _compute_obj(project: ProjectCore, spec: OptSpec) -> float:
    """Read objective directly from model.products — no DataFrame overhead."""
    model = project._model
    if model is None:
        return 0.0
    scope_set = set(spec.scope_skus)
    bound_map = {b.sku: b for b in spec.bounds}
    total = 0.0
    for p in model.products:
        if p.name not in scope_set or not p.included:
            continue
        if spec.objective == "revenue":
            total += p.revenue
        elif spec.objective == "value_share":
            total += p.value_share
        elif spec.objective == "volume_share":
            total += p.new_share
        elif spec.objective == "margin":
            try:
                price_val = float(
                    p.new_attributes.get("Price", p.base_attributes.get("Price", 1.0)) or 1.0
                )
            except (TypeError, ValueError):
                price_val = 1.0
            cost = _sku_unit_cost(spec, p.name)
            if cost is None:
                from data.unit_costs import unit_cost_gap_message

                raise ValueError(unit_cost_gap_message([p.name]))
            if price_val > 0:
                total += p.revenue * max(price_val - cost, 0.0) / price_val
    return total


def _scope_volume_share(project: ProjectCore, scope_skus: list[str]) -> float:
    model = project._model
    if model is None:
        return 0.0
    scope_set = set(scope_skus)
    return sum(
        p.new_share for p in model.products if p.name in scope_set and p.included
    )


def _vol_drop_pct(base: float, new: float) -> float:
    """Positive => volume lost vs baseline; negative => volume gained."""
    if base <= 0:
        return 0.0
    return (base - new) / base * 100.0


def _is_feasible(spec: OptSpec, brand_volume: float) -> bool:
    if spec.max_volume_drop_pct is None:
        return True
    baseline = spec.baseline_brand_volume
    if baseline is None:
        return True
    return _vol_drop_pct(baseline, brand_volume) <= float(spec.max_volume_drop_pct) + 1e-9


# ── reference / anchor / corridor + PPA ladder (price-only, no sim needed) ──

def _corridor_ratio(spec: OptSpec, prices: dict[str, float]) -> float | None:
    """Reference-SKU price ÷ anchor price, on the configured basis. None if not configured."""
    if not spec.reference_sku or spec.anchor_price is None or spec.anchor_price <= 0:
        return None
    ref_price = prices.get(spec.reference_sku)
    if ref_price is None:
        return None
    if spec.corridor_basis == "unit" and spec.reference_size and spec.anchor_size:
        ref_val = ref_price / spec.reference_size
        anchor_val = spec.anchor_price / spec.anchor_size
    else:
        ref_val = ref_price
        anchor_val = spec.anchor_price
    if anchor_val <= 0:
        return None
    return ref_val / anchor_val


def _corridor_ok(spec: OptSpec, prices: dict[str, float]) -> bool:
    ratio = _corridor_ratio(spec, prices)
    if ratio is None:
        return True
    if spec.corridor_min is not None and ratio < spec.corridor_min - 1e-9:
        return False
    if spec.corridor_max is not None and ratio > spec.corridor_max + 1e-9:
        return False
    return True


def _ppa_ladder_ok(spec: OptSpec, prices: dict[str, float]) -> bool:
    """Enforce: larger pack costs more in absolute terms, but no more per unit
    (within an optional min/max €/unit saving band vs the next smaller pack).

    Missing sizes on an active chain are a failed check (not a silent skip), so
    unit-price rules cannot be bypassed when PPA is enabled.
    """
    for chain in spec.ppa_size_chains:
        c = [s for s in chain if s in prices]
        if len(c) < 2:
            continue
        for a, b in zip(c, c[1:]):
            pa, pb = prices[a], prices[b]
            if pb <= pa + 1e-9:  # absolute pack price must increase with size
                return False
            sa, sb = spec.ppa_sizes.get(a), spec.ppa_sizes.get(b)
            if not sa or not sb:
                return False
            ua, ub = pa / sa, pb / sb
            if ub > ua + 1e-9:  # larger pack must not cost more per unit
                return False
            if spec.ppa_min_saving is not None and ub > ua * (1 - spec.ppa_min_saving) + 1e-9:
                return False
            if spec.ppa_max_saving is not None and ub < ua * (1 - spec.ppa_max_saving) - 1e-9:
                return False
                
    for link in spec.ppa_tier_links:
        high = link.get("high_sku")
        low = link.get("low_sku")
        if high in prices and low in prices:
            pa, pb = prices[low], prices[high]
            sa, sb = spec.ppa_sizes.get(low), spec.ppa_sizes.get(high)
            if not sa or not sb:
                return False
            ua, ub = pa / sa, pb / sb
            min_p = link.get("min_premium_pct") or 0.0
            if ub <= ua * (1 + min_p) + 1e-9:
                return False

    return True


def _sku_unit_cost(spec: OptSpec, sku: str) -> float | None:
    """Stored study cost, else the cost on this SKU's price bound. Never invents one."""
    if sku in spec.unit_costs:
        return spec.unit_costs[sku]
    for bound in spec.bounds:
        if bound.sku == sku:
            return bound.cost
    return None


def _positive_cost(cost: float | None) -> TypeGuard[float]:
    return cost is not None and cost > 0


def _margin_floor_price(cost: float | None, min_margin_pct: float) -> float | None:
    """Minimum acceptable price for a given cost and margin floor (fraction of price)."""
    if not _positive_cost(cost) or min_margin_pct is None:
        return None
    if min_margin_pct >= 1.0 - 1e-12:
        return None
    if min_margin_pct <= 0:
        return None
    return cost / (1.0 - min_margin_pct)


def _ceil_money(x: float) -> float:
    """Round up to the next cent so a margin floor is never undercut by 2-dp rounding."""
    return math.ceil(x * 100.0 - 1e-9) / 100.0


def _floor_money(x: float) -> float:
    """Round down to the previous cent for upper bounds."""
    return math.floor(x * 100.0 + 1e-9) / 100.0


def _margin_ok(spec: OptSpec, prices: dict[str, float]) -> bool:
    if spec.min_margin_pct is None:
        return True
    for b in spec.bounds:
        p = prices.get(b.sku)
        if p is None:
            continue
        if b.cost is None:
            return False
        if b.cost <= 0:
            continue
        if p <= 0:
            return False
        if (p - b.cost) / p < spec.min_margin_pct - 1e-9:
            return False
    return True


def apply_guardrail_bounds(spec: OptSpec) -> list[str]:
    """Tighten each SKU's [lo, hi] by margin floor. Returns conflict msgs."""
    msgs: list[str] = []
    for b in spec.bounds:
        lo, hi = b.lo, b.hi
        if spec.min_margin_pct is not None:
            floor = _margin_floor_price(b.cost, spec.min_margin_pct)
            if floor is not None:
                lo = max(lo, floor)
        if lo > hi + 1e-9:
            msgs.append(
                f"{b.sku}: margin guardrail conflicts with price bounds "
                f"(effective window [{lo:.4g}, {hi:.4g}] is empty). "
                f"Widen min/max or lower the margin floor."
            )
        else:
            b.lo, b.hi = lo, hi
    return msgs


def _build_menus(spec: OptSpec, max_menu: int = 15) -> tuple[dict[str, list[float]], list[str]]:
    """Build the finite list of allowed prices for each SKU."""
    menus: dict[str, list[float]] = {}
    msgs: list[str] = []
    
    for b in spec.bounds:
        lo, hi = b.lo, b.hi
        
        if spec.min_margin_pct is not None:
            floor = _margin_floor_price(b.cost, spec.min_margin_pct)
            if floor is not None:
                lo = max(lo, floor)
                
        if (
            b.sku == spec.reference_sku
            and spec.anchor_price
            and spec.anchor_price > 0
        ):
            if spec.corridor_basis == "unit" and spec.reference_size and spec.anchor_size:
                anchor_unit = spec.anchor_price / spec.anchor_size
                if spec.corridor_min is not None:
                    lo = max(lo, spec.corridor_min * anchor_unit * spec.reference_size)
                if spec.corridor_max is not None:
                    hi = min(hi, spec.corridor_max * anchor_unit * spec.reference_size)
            else:
                if spec.corridor_min is not None:
                    lo = max(lo, spec.corridor_min * spec.anchor_price)
                if spec.corridor_max is not None:
                    hi = min(hi, spec.corridor_max * spec.anchor_price)
                    
        # Snap bounds to cents before gridding: ceil lo so margin floors survive
        # round(..., 2); floor hi so corridor/max caps are not exceeded.
        lo_c, hi_c = _ceil_money(lo), _floor_money(hi)
        if lo_c > hi_c + 1e-9:
            msgs.append(
                f"{b.sku}: guardrails conflict with price bounds "
                f"(effective window [{lo:.4g}, {hi:.4g}] is empty)."
            )
            menus[b.sku] = []
            continue

        cands_list = [round(float(p), 2) for p in np.linspace(lo_c, hi_c, max_menu)]
        cands_list = sorted(set(cands_list + [lo_c, hi_c]))
        if spec.min_margin_pct is not None and _positive_cost(b.cost):
            floor_pct = spec.min_margin_pct - 1e-9
            cost = b.cost
            cands_list = [
                p for p in cands_list if p > 0 and (p - cost) / p >= floor_pct
            ]
        if not cands_list:
            msgs.append(
                f"{b.sku}: guardrails conflict with price bounds "
                f"(effective window [{lo:.4g}, {hi:.4g}] is empty)."
            )
        menus[b.sku] = cands_list

    return menus, msgs


def _ppa_ladder_rows(spec: OptSpec, prices: dict[str, float]) -> list[dict]:
    """Pack-ladder diagnostic rows for the UI (price, €/unit, saving, pass/fail)."""
    rows_by_sku: dict[str, dict] = {}
    row_order: list[str] = []

    for i, chain in enumerate(spec.ppa_size_chains):
        c = [s for s in chain if s in prices]
        prev_unit: float | None = None
        prev_sku: str | None = None
        for sku in c:
            price = prices[sku]
            size = spec.ppa_sizes.get(sku)
            unit = (price / size) if size and size > 0 else None
            saving = None
            status = "ok"
            detail = ""
            if prev_unit is not None and unit is not None and prev_sku is not None:
                prev_price = prices[prev_sku]
                saving = 1.0 - (unit / prev_unit) if prev_unit > 0 else None
                if price <= prev_price + 1e-9:
                    status = "fail"
                    detail = "absolute_order"
                elif unit > prev_unit + 1e-9:
                    status = "fail"
                    detail = "unit_order"
                elif (
                    spec.ppa_min_saving is not None
                    and unit > prev_unit * (1 - spec.ppa_min_saving) + 1e-9
                ):
                    status = "fail"
                    detail = "min_saving"
                elif (
                    spec.ppa_max_saving is not None
                    and unit < prev_unit * (1 - spec.ppa_max_saving) - 1e-9
                ):
                    status = "fail"
                    detail = "max_saving"
                else:
                    status = "ok"
                    detail = "within_band"
            if sku not in rows_by_sku:
                row_order.append(sku)
            rows_by_sku[sku] = {
                "sku": sku,
                "price": price,
                "size": size,
                "unit_price": unit,
                "saving_vs_prev": saving,
                "tier_premium_vs_low": None,
                "status": status,
                "detail": detail,
                "chain_index": i,
                "is_tier_link": False,
            }
            prev_unit = unit
            prev_sku = sku

    for i, link in enumerate(spec.ppa_tier_links):
        high = link.get("high_sku")
        low = link.get("low_sku")
        if high in prices and low in prices:
            price_h, price_l = prices[high], prices[low]
            sh, sl = spec.ppa_sizes.get(high), spec.ppa_sizes.get(low)
            uh = (price_h / sh) if sh and sh > 0 else None
            ul = (price_l / sl) if sl and sl > 0 else None
            tier_status = "ok"
            tier_detail = ""
            prem = None
            if uh is not None and ul is not None and ul > 0:
                prem = (uh / ul) - 1.0
                min_p = link.get("min_premium_pct") or 0.0
                if uh <= ul * (1 + min_p) + 1e-9:
                    tier_status = "fail"
                    tier_detail = "min_premium"
            existing = rows_by_sku.get(high)
            if existing is not None:
                existing["tier_premium_vs_low"] = prem
                existing["low_sku"] = low
                existing["link_index"] = i
                if tier_status == "fail":
                    existing["status"] = "fail"
                    existing["detail"] = tier_detail
            else:
                if high not in rows_by_sku:
                    row_order.append(high)
                rows_by_sku[high] = {
                    "sku": high,
                    "price": price_h,
                    "size": sh,
                    "unit_price": uh,
                    "saving_vs_prev": None,
                    "tier_premium_vs_low": prem,
                    "low_sku": low,
                    "status": tier_status,
                    "detail": tier_detail,
                    "link_index": i,
                    "is_tier_link": True,
                }

    return [rows_by_sku[sku] for sku in row_order]


def _sku_limited_by(spec: OptSpec, prices: dict[str, float], tol: float = 0.01) -> dict[str, str]:
    """Map each decision SKU to the commercial rule pinning its price (if any)."""
    out: dict[str, str] = {}
    bound_map = {b.sku: b for b in spec.bounds}

    # Corridor pins the reference SKU
    ratio = _corridor_ratio(spec, prices)
    if ratio is not None and spec.reference_sku:
        if spec.corridor_min is not None and abs(ratio - spec.corridor_min) < tol:
            out[spec.reference_sku] = "corridor_min"
        elif spec.corridor_max is not None and abs(ratio - spec.corridor_max) < tol:
            out[spec.reference_sku] = "corridor_max"

    # PPA pins the larger pack in each link
    for chain in spec.ppa_size_chains:
        c = [s for s in chain if s in prices]
        for a, b in zip(c, c[1:]):
            if b in out:
                continue
            sa, sb = spec.ppa_sizes.get(a), spec.ppa_sizes.get(b)
            if not sa or not sb:
                continue
            ua, ub = prices[a] / sa, prices[b] / sb
            if abs(prices[b] - prices[a]) < tol:
                out[b] = f"ppa_order:{a}->{b}"
            elif spec.ppa_min_saving is not None and abs(ub - ua * (1 - spec.ppa_min_saving)) < tol * max(ua, 1e-9):
                out[b] = f"ppa_min_saving:{a}->{b}"
            elif spec.ppa_max_saving is not None and abs(ub - ua * (1 - spec.ppa_max_saving)) < tol * max(ua, 1e-9):
                out[b] = f"ppa_max_saving:{a}->{b}"
                
    for link in spec.ppa_tier_links:
        high = link.get("high_sku")
        low = link.get("low_sku")
        if high in prices and low in prices and high not in out:
            sh, sl = spec.ppa_sizes.get(high), spec.ppa_sizes.get(low)
            if not sh or not sl: continue
            uh, ul = prices[high] / sh, prices[low] / sl
            min_p = link.get("min_premium_pct") or 0.0
            if abs(uh - ul * (1 + min_p)) < tol * max(ul, 1e-9):
                out[high] = f"ppa_tier_premium:{low}->{high}"

    for b in spec.bounds:
        p = prices.get(b.sku)
        if p is None or b.sku in out:
            continue
        # Margin floor
        if spec.min_margin_pct is not None and _positive_cost(b.cost):
            floor = _margin_floor_price(b.cost, spec.min_margin_pct)
            if floor is not None and abs(p - floor) <= max(tol, floor * 0.002):
                out[b.sku] = "margin_floor"
                continue
        # Ordinary min/max bound
        edge_tol = max(0.05, p * 0.002)
        if abs(p - b.lo) <= edge_tol:
            out[b.sku] = "bound_min"
        elif abs(p - b.hi) <= edge_tol:
            out[b.sku] = "bound_max"
    return out


def _constraints_ok(spec: OptSpec, prices: dict[str, float]) -> bool:
    return (
        _corridor_ok(spec, prices)
        and _ppa_ladder_ok(spec, prices)
        and _margin_ok(spec, prices)
    )


def _ppa_violation_messages(spec: OptSpec, prices: dict[str, float]) -> list[str]:
    """Human-readable PPA failures for the given price vector."""
    msgs: list[str] = []
    for chain in spec.ppa_size_chains:
        c = [s for s in chain if s in prices]
        for a, b in zip(c, c[1:]):
            pa, pb = prices[a], prices[b]
            if pb <= pa + 1e-9:
                msgs.append(
                    f"PPA absolute order: {b} ({pb:.4g}) must cost more than {a} ({pa:.4g})"
                )
                continue
            sa, sb = spec.ppa_sizes.get(a), spec.ppa_sizes.get(b)
            if not sa or not sb:
                msgs.append(f"PPA unit rules need numeric Size for both {a} and {b}")
                continue
            ua, ub = pa / sa, pb / sb
            saving = 1.0 - (ub / ua) if ua > 0 else float("nan")
            if ub > ua + 1e-9:
                msgs.append(
                    f"PPA unit price: {b} is {ub:.6g}/unit vs {a} at {ua:.6g}/unit "
                    f"(larger pack is more expensive per unit; saving={saving:.1%})"
                )
            elif spec.ppa_min_saving is not None and ub > ua * (1 - spec.ppa_min_saving) + 1e-9:
                msgs.append(
                    f"PPA min unit saving {spec.ppa_min_saving:.0%}: {a}→{b} only saves "
                    f"{saving:.1%} per unit (need ≥ {spec.ppa_min_saving:.0%})"
                )
            elif spec.ppa_max_saving is not None and ub < ua * (1 - spec.ppa_max_saving) - 1e-9:
                msgs.append(
                    f"PPA max unit saving {spec.ppa_max_saving:.0%}: {a}→{b} saves "
                    f"{saving:.1%} per unit (need ≤ {spec.ppa_max_saving:.0%})"
                )
                
    for link in spec.ppa_tier_links:
        high = link.get("high_sku")
        low = link.get("low_sku")
        if high in prices and low in prices:
            pa, pb = prices[low], prices[high]
            sa, sb = spec.ppa_sizes.get(low), spec.ppa_sizes.get(high)
            if not sa or not sb:
                msgs.append(f"PPA tier rules need numeric Size for both {low} and {high}")
                continue
            ua, ub = pa / sa, pb / sb
            min_p = link.get("min_premium_pct") or 0.0
            if ub <= ua * (1 + min_p) + 1e-9:
                msgs.append(
                    f"PPA tier premium: {high} ({ub:.6g}/unit) must be at least {min_p:.0%} "
                    f"more premium than {low} ({ua:.6g}/unit)"
                )
                
    if spec.min_margin_pct is not None:
        for b in spec.bounds:
            p = prices.get(b.sku)
            if p is None or not _positive_cost(b.cost) or p <= 0:
                continue
            margin = (p - b.cost) / p
            if margin < spec.min_margin_pct - 1e-9:
                msgs.append(
                    f"Margin floor {spec.min_margin_pct:.0%}: {b.sku} at {p:.4g} "
                    f"only has {margin:.1%} margin (cost {b.cost:.4g})"
                )
    return msgs


def _ensure_finite_baseline(
    project: ProjectCore, spec: OptSpec, base_prices: dict[str, float], baseline: float
) -> float:
    """If the base prices themselves violate the corridor/PPA rules, still report a
    real baseline objective (ignoring those constraints just for this number) so
    uplift % stays interpretable instead of showing as null/-inf."""
    if math.isfinite(baseline):
        return baseline
    _set_prices(project, base_prices)
    scope_vol = _scope_volume_share(project, spec.scope_skus)
    if spec.max_volume_drop_pct is not None and spec.baseline_brand_volume is None:
        spec.baseline_brand_volume = scope_vol
    return _compute_obj(project, spec)


def _binding_constraints(spec: OptSpec, prices: dict[str, float], tol: float = 0.01) -> list[str]:
    out: list[str] = []
    ratio = _corridor_ratio(spec, prices)
    if ratio is not None:
        if spec.corridor_min is not None and abs(ratio - spec.corridor_min) < tol:
            out.append("corridor_min")
        if spec.corridor_max is not None and abs(ratio - spec.corridor_max) < tol:
            out.append("corridor_max")
            
    for chain in spec.ppa_size_chains:
        c = [s for s in chain if s in prices]
        for a, b in zip(c, c[1:]):
            sa, sb = spec.ppa_sizes.get(a), spec.ppa_sizes.get(b)
            if not sa or not sb:
                continue
            ua, ub = prices[a] / sa, prices[b] / sb
            if spec.ppa_min_saving is not None and abs(ub - ua * (1 - spec.ppa_min_saving)) < tol * ua:
                out.append(f"ppa_min_saving:{a}->{b}")
            if spec.ppa_max_saving is not None and abs(ub - ua * (1 - spec.ppa_max_saving)) < tol * ua:
                out.append(f"ppa_max_saving:{a}->{b}")
                
    for link in spec.ppa_tier_links:
        high = link.get("high_sku")
        low = link.get("low_sku")
        if high in prices and low in prices:
            sh, sl = spec.ppa_sizes.get(high), spec.ppa_sizes.get(low)
            if not sh or not sl: continue
            uh, ul = prices[high] / sh, prices[low] / sl
            min_p = link.get("min_premium_pct") or 0.0
            if abs(uh - ul * (1 + min_p)) < tol * ul:
                out.append(f"ppa_tier_premium:{low}->{high}")

    if spec.min_margin_pct is not None:
        for b in spec.bounds:
            p = prices.get(b.sku)
            floor = _margin_floor_price(b.cost, spec.min_margin_pct)
            if p is not None and floor is not None and abs(p - floor) <= max(tol, floor * 0.002):
                out.append(f"margin_floor:{b.sku}")
    return out


def validate_constraint_setup(spec: OptSpec) -> list[str]:
    """Return setup problems (missing sizes, empty corridor box, empty PPA region)."""
    msgs: list[str] = []
    bound_map = {b.sku: b for b in spec.bounds}

    msgs.extend(apply_guardrail_bounds(spec))
    # Re-read after guardrail mutation
    bound_map = {b.sku: b for b in spec.bounds}

    missing = set()
    for chain in spec.ppa_size_chains:
        for s in chain:
            if s not in spec.ppa_sizes:
                missing.add(s)
    for link in spec.ppa_tier_links:
        high = link.get("high_sku")
        low = link.get("low_sku")
        if high and high not in spec.ppa_sizes: missing.add(high)
        if low and low not in spec.ppa_sizes: missing.add(low)
        
    if missing:
        msgs.append("PPA ladder needs a numeric Size attribute for: " + ", ".join(sorted(missing)))
    elif spec.ppa_size_chains and not _ppa_feasible_region_nonempty(spec, bound_map):
        min_s = spec.ppa_min_saving
        max_s = spec.ppa_max_saving
        band = ""
        if min_s is not None or max_s is not None:
            lo_lbl = "0%" if min_s is None else f"{min_s:.0%}"
            hi_lbl = "∞" if max_s is None else f"{max_s:.0%}"
            band = f" with unit-saving band [{lo_lbl}, {hi_lbl}]"
        msgs.append(
            "No prices inside the min/max bounds satisfy the PPA ladder"
            f"{band}. Widen bounds, lower min unit saving, or raise a "
            "larger pack's price floor."
        )

    if (
        spec.reference_sku
        and spec.anchor_price
        and spec.anchor_price > 0
        and (spec.corridor_min is not None or spec.corridor_max is not None)
    ):
        b = bound_map.get(spec.reference_sku)
        if b is not None:
            lo_c, hi_c = b.lo, b.hi
            if spec.corridor_basis == "unit" and spec.reference_size and spec.anchor_size:
                anchor_unit = spec.anchor_price / spec.anchor_size
                if spec.corridor_min is not None:
                    lo_c = max(lo_c, spec.corridor_min * anchor_unit * spec.reference_size)
                if spec.corridor_max is not None:
                    hi_c = min(hi_c, spec.corridor_max * anchor_unit * spec.reference_size)
            else:
                if spec.corridor_min is not None:
                    lo_c = max(lo_c, spec.corridor_min * spec.anchor_price)
                if spec.corridor_max is not None:
                    hi_c = min(hi_c, spec.corridor_max * spec.anchor_price)
            if lo_c > hi_c + 1e-9:
                msgs.append(
                    f"Corridor vs anchor conflicts with price bounds for "
                    f"{spec.reference_sku}: effective window [{lo_c:.4g}, {hi_c:.4g}] is empty"
                )

    return msgs


def _ppa_feasible_region_nonempty(spec: OptSpec, bound_map: dict[str, PriceBound]) -> bool:
    """True if some price vector in the boxes satisfies PPA absolute + unit rules."""
    for chain in spec.ppa_size_chains:
        c = [s for s in chain if s in bound_map and s in spec.ppa_sizes]
        if len(c) < 2:
            continue

        intervals: dict[str, tuple[float, float]] = {}
        first = c[0]
        bf = bound_map[first]
        intervals[first] = (bf.lo, bf.hi)

        for a, b in zip(c, c[1:]):
            bb = bound_map[b]
            sa, sb = spec.ppa_sizes[a], spec.ppa_sizes[b]
            lo_a, hi_a = intervals[a]
            found = False
            lo_b_best, hi_b_best = bb.hi + 1.0, bb.lo - 1.0
            for pa in np.linspace(lo_a, hi_a, 25):
                ua = float(pa) / sa
                lo_b = max(bb.lo, float(pa) + 1e-6)
                hi_b = min(bb.hi, ua * sb)
                if spec.ppa_min_saving is not None:
                    hi_b = min(hi_b, ua * (1 - spec.ppa_min_saving) * sb)
                if spec.ppa_max_saving is not None:
                    lo_b = max(lo_b, ua * (1 - spec.ppa_max_saving) * sb)
                if lo_b <= hi_b + 1e-9:
                    found = True
                    lo_b_best = min(lo_b_best, lo_b)
                    hi_b_best = max(hi_b_best, hi_b)
            if not found:
                return False
            intervals[b] = (lo_b_best, hi_b_best)
            
    # For now, treat each chain independently and don't strictly check tier links for emptiness
    # since tier links are just U(high) > U(low) * (1 + min_premium).
    return True


def try_repair_ppa_seed(spec: OptSpec, prices: dict[str, float]) -> dict[str, float] | None:
    """Project prices into a PPA-feasible seed within bounds, or None if impossible."""
    bound_map = {b.sku: b for b in spec.bounds}
    out = dict(prices)
    
    for chain in spec.ppa_size_chains:
        c = [s for s in chain if s in bound_map]
        if len(c) < 2 or any(s not in spec.ppa_sizes for s in c):
            continue

        first = c[0]
        b0 = bound_map[first]
        out[first] = float(min(max(out.get(first, b0.base_price), b0.lo), b0.hi))

        for a, b in zip(c, c[1:]):
            ba, bb = bound_map[a], bound_map[b]
            sa, sb = spec.ppa_sizes[a], spec.ppa_sizes[b]
            pa = out[a]
            ua = pa / sa
            lo_b = max(bb.lo, pa + 1e-6)
            hi_b = min(bb.hi, ua * sb)
            if spec.ppa_min_saving is not None:
                hi_b = min(hi_b, ua * (1 - spec.ppa_min_saving) * sb)
            if spec.ppa_max_saving is not None:
                lo_b = max(lo_b, ua * (1 - spec.ppa_max_saving) * sb)
            if lo_b > hi_b + 1e-9:
                repaired = False
                for pa_try in np.linspace(ba.lo, ba.hi, 40):
                    pa_try_f = float(pa_try)
                    if pa_try_f >= bb.hi:
                        continue
                    ua_try = pa_try_f / sa
                    lo_t = max(bb.lo, pa_try_f + 1e-6)
                    hi_t = min(bb.hi, ua_try * sb)
                    if spec.ppa_min_saving is not None:
                        hi_t = min(hi_t, ua_try * (1 - spec.ppa_min_saving) * sb)
                    if spec.ppa_max_saving is not None:
                        lo_t = max(lo_t, ua_try * (1 - spec.ppa_max_saving) * sb)
                    if lo_t <= hi_t + 1e-9:
                        out[a] = pa_try_f
                        cur_b = out.get(b, bb.base_price)
                        out[b] = float(min(max(cur_b, lo_t), hi_t))
                        repaired = True
                        break
                if not repaired:
                    return None
            else:
                cur_b = out.get(b, bb.base_price)
                out[b] = float(min(max(cur_b, lo_b), hi_b))

    for link in spec.ppa_tier_links:
        high, low = link.get("high_sku"), link.get("low_sku")
        if high in out and low in out and high in spec.ppa_sizes and low in spec.ppa_sizes:
            sh, sl = spec.ppa_sizes[high], spec.ppa_sizes[low]
            min_p = link.get("min_premium_pct") or 0.0
            uh = out[high] / sh
            ul = out[low] / sl
            if uh < ul * (1 + min_p) - 1e-9:
                bh, bl = bound_map.get(high), bound_map.get(low)
                if bh and bl:
                    req_ph = ul * (1 + min_p) * sh
                    if req_ph <= bh.hi + 1e-9:
                        out[high] = min(bh.hi, max(bh.lo, req_ph))
                    else:
                        req_pl = (uh / (1 + min_p)) * sl
                        if req_pl >= bl.lo - 1e-9:
                            out[low] = max(bl.lo, min(bl.hi, req_pl))

    if not _corridor_ok(spec, out):
        return None
    return out if _ppa_ladder_ok(spec, out) else None


def preflight_constraints(spec: OptSpec) -> tuple[list[str], dict[str, float] | None]:
    """Validate setup and return (conflicts, feasible_seed_or_None)."""
    conflicts = validate_constraint_setup(spec)
    if conflicts:
        return conflicts, None
    base = {b.sku: b.base_price for b in spec.bounds}
    if _constraints_ok(spec, base):
        return [], base
    repaired = try_repair_ppa_seed(spec, base)
    if repaired is not None and _constraints_ok(spec, repaired):
        return [], repaired
    if spec.reference_sku and spec.anchor_price and spec.reference_sku in base:
        clipped = dict(base)
        bmap = {b.sku: b for b in spec.bounds}
        br = bmap[spec.reference_sku]
        lo_c, hi_c = br.lo, br.hi
        if spec.corridor_basis == "unit" and spec.reference_size and spec.anchor_size:
            au = spec.anchor_price / spec.anchor_size
            if spec.corridor_min is not None:
                lo_c = max(lo_c, spec.corridor_min * au * spec.reference_size)
            if spec.corridor_max is not None:
                hi_c = min(hi_c, spec.corridor_max * au * spec.reference_size)
        else:
            if spec.corridor_min is not None:
                lo_c = max(lo_c, spec.corridor_min * spec.anchor_price)
            if spec.corridor_max is not None:
                hi_c = min(hi_c, spec.corridor_max * spec.anchor_price)
        if lo_c <= hi_c + 1e-9:
            clipped[spec.reference_sku] = float(
                min(max(clipped[spec.reference_sku], lo_c), hi_c)
            )
            if _constraints_ok(spec, clipped):
                return [], clipped
    msgs = _ppa_violation_messages(spec, base)
    if not msgs:
        msgs = [
            "Starting prices violate commercial constraints and no feasible seed was found"
        ]
    return msgs, None


def _opt_result(
    project: ProjectCore,
    spec: OptSpec,
    *,
    prices: dict[str, float],
    objective_value: float,
    baseline_value: float,
    n_evals: int,
    obj_history: list[float],
    sweep_data: dict | None,
    infeasible_trials: int = 0,
    base_prices: dict[str, float] | None = None,
    solution_status: str = "optimal_found",
    constraint_conflicts: list[str] | None = None,
    raw_prices: dict[str, float] | None = None,
    menus: dict[str, list[float]] | None = None,
) -> OptResult:
    conflicts = list(constraint_conflicts or [])
    if solution_status != "infeasible" and not _constraints_ok(spec, prices):
        solution_status = "infeasible"
        conflicts = conflicts or _ppa_violation_messages(spec, prices)
        if not conflicts:
            conflicts = ["Final prices violate commercial constraints"]
    limited = _sku_limited_by(spec, prices) if solution_status != "infeasible" else {}
    final_vol = _scope_volume_share(project, spec.scope_skus)
    baseline_vol = float(spec.baseline_brand_volume or 0.0)
    return OptResult(
        prices=prices,
        objective_value=objective_value,
        baseline_value=baseline_value,
        n_evals=n_evals,
        obj_history=obj_history,
        sweep_data=sweep_data,
        baseline_brand_volume=baseline_vol,
        final_brand_volume=final_vol,
        brand_volume_drop_pct=_vol_drop_pct(baseline_vol, final_vol),
        max_volume_drop_pct=spec.max_volume_drop_pct,
        corridor_ratio=_corridor_ratio(spec, prices),
        binding_constraints=_binding_constraints(spec, prices),
        infeasible_trials=infeasible_trials,
        base_prices_violate_constraints=(
            base_prices is not None and not _constraints_ok(spec, base_prices)
        ),
        solution_status=solution_status,
        constraint_conflicts=conflicts,
        limited_by=limited,
        ppa_ladder_rows=_ppa_ladder_rows(spec, prices)
        if (spec.ppa_size_chains or spec.ppa_tier_links)
        else [],
        raw_prices=dict(raw_prices or prices),
        n_passes=max(0, len(obj_history) - 1),
        menus=menus,
    )


def _try_create_fast_evaluator(project: ProjectCore, spec: OptSpec):
    """Build FastEvaluator when Price attribute is available; else None."""
    model = project._model
    if model is None or model.price_attribute_index < 0:
        return None
    try:
        from model.fast_evaluator import FastEvaluator, build_decision_variables

        bounds_tuples = [
            (b.sku, b.base_price, b.lo, b.hi, b.cost) for b in spec.bounds
        ]
        variables = build_decision_variables(
            model, bounds_tuples, step_pct=0.01, max_levels=50
        )
        fe = FastEvaluator(model, [b.sku for b in spec.bounds])
        fe.configure(
            variables,
            scope_skus=spec.scope_skus,
            objective=spec.objective,  # type: ignore[arg-type]
            max_volume_drop_pct=spec.max_volume_drop_pct,
            unit_costs=spec.unit_costs,
        )
        return fe
    except (ValueError, KeyError):
        return None


def _eval(
    project: ProjectCore,
    spec: OptSpec,
    prices: dict[str, float],
    ctr: list[int],
    cb: Callable[[int, float], None] | None,
    fast_eval=None,
    skip_constraints: bool = False,
) -> float:
    ctr[0] += 1
    if not skip_constraints and not _constraints_ok(spec, prices):
        if len(ctr) > 1:
            ctr[1] += 1
        if cb:
            cb(ctr[0], 0.0)
        return float("-inf")
    if fast_eval is not None:
        result = fast_eval.evaluate_at_prices(prices, restore_prices=False)
        if (
            spec.max_volume_drop_pct is not None
            and spec.baseline_brand_volume is None
        ):
            spec.baseline_brand_volume = result.target_volume_share
            fast_eval.set_floor_baseline(result.target_volume_share)
        val = result.objective if result.feasible else float("-inf")
    else:
        _set_prices(project, prices)
        scope_vol = _scope_volume_share(project, spec.scope_skus)
        if (
            spec.max_volume_drop_pct is not None
            and spec.baseline_brand_volume is None
        ):
            spec.baseline_brand_volume = scope_vol
        if not _is_feasible(spec, scope_vol):
            val = float("-inf")
        else:
            val = _compute_obj(project, spec)
    if cb:
        cb(ctr[0], val if val != float("-inf") else 0.0)
    return val


def _finalize_opt(
    project: ProjectCore,
    spec: OptSpec,
    *,
    prices: dict[str, float],
    baseline_value: float,
    base_prices: dict[str, float],
    n_evals: int,
    obj_history: list[float],
    sweep_data: dict | None,
    infeasible_trials: int,
    found_feasible: bool,
    preflight_conflicts: list[str] | None = None,
    menus: dict[str, list[float]] | None = None,
) -> OptResult:
    """Apply prices, gate on constraints, and build OptResult with honest status."""
    if not found_feasible or not _constraints_ok(spec, prices):
        conflicts = list(preflight_conflicts or [])
        conflicts.extend(_ppa_violation_messages(spec, prices))
        if not conflicts:
            conflicts = ["No feasible prices found under commercial constraints"]
        # Still materialize base (or last) prices for the results table.
        show = dict(base_prices)
        _set_prices(project, show)
        project.reload_results()
        baseline = _ensure_finite_baseline(project, spec, base_prices, baseline_value)
        return _opt_result(
            project,
            spec,
            prices=show,
            objective_value=baseline,
            baseline_value=baseline,
            n_evals=n_evals,
            obj_history=obj_history,
            sweep_data=None,
            infeasible_trials=infeasible_trials,
            base_prices=base_prices,
            solution_status="infeasible",
            constraint_conflicts=conflicts,
            menus=menus,
        )

    _set_prices(project, prices)
    final = _compute_obj(project, spec)
    project.reload_results()

    return _opt_result(
        project,
        spec,
        prices=dict(prices),
        objective_value=final,
        baseline_value=baseline_value,
        n_evals=n_evals,
        obj_history=obj_history,
        sweep_data=sweep_data,
        infeasible_trials=infeasible_trials,
        base_prices=base_prices,
        solution_status="optimal_found",
        raw_prices=dict(prices),
        menus=menus,
    )


# ── price sweep for 1-SKU chart ──────────────────────────────────────────────

def _sweep_1sku(
    project: ProjectCore,
    spec: OptSpec,
    best_prices: dict[str, float],
    ctr: list[int],
    n: int = 25,
    fast_eval=None,
) -> dict:
    if len(spec.bounds) != 1:
        return {}
    b = spec.bounds[0]
    xs = list(np.linspace(b.lo, b.hi, n))
    ys = []
    for p in xs:
        trial = dict(best_prices)
        trial[b.sku] = float(p)
        ys.append(_eval(project, spec, trial, ctr, None, fast_eval))
    _set_prices(project, best_prices)
    return {"prices": xs, "values": ys, "sku": b.sku, "optimal": best_prices[b.sku]}


# ── coordinate ascent ────────────────────────────────────────────────────────

def _generate_starts(spec: OptSpec, menus: dict[str, list[float]], n_random: int = 1) -> list[dict[str, float]]:
    starts = []
    
    current = {}
    for b in spec.bounds:
        if not menus[b.sku]:
            continue
        nearest = min(menus[b.sku], key=lambda p: abs(p - b.base_price))
        current[b.sku] = nearest
    if len(current) == sum(1 for b in spec.bounds if menus[b.sku]):
        starts.append(current)
        
    min_start = {b.sku: menus[b.sku][0] for b in spec.bounds if menus[b.sku]}
    if min_start and min_start not in starts:
        starts.append(min_start)
        
    max_start = {b.sku: menus[b.sku][-1] for b in spec.bounds if menus[b.sku]}
    if max_start and max_start not in starts:
        starts.append(max_start)
        
    mid_start = {}
    for b in spec.bounds:
        if not menus[b.sku]:
            continue
        mid_idx = len(menus[b.sku]) // 2
        mid_start[b.sku] = menus[b.sku][mid_idx]
    if mid_start and mid_start not in starts:
        starts.append(mid_start)
        
    import random
    rng = random.Random(42)
    for _ in range(n_random):
        rand_start = {b.sku: rng.choice(menus[b.sku]) for b in spec.bounds if menus[b.sku]}
        if rand_start not in starts:
            starts.append(rand_start)
            
    return starts


def _get_blocks(spec: OptSpec) -> list[list[str]]:
    """Build coordinate ascent blocks for PPA and unconstrained SKUs.

    Hierarchical / decoupled structure (Option 2):
    1. Cross-tier Reference SKU block: links reference SKUs across tiers without
       merging all within-tier sizes into a massive combinatorial explosion.
    2. Within-tier size chain blocks: each tier's size chain forms an independent block.
    3. Any remaining independent SKUs: 1D blocks.
    """
    blocks: list[list[str]] = []

    # 1. Cross-tier reference SKUs (from ppa_tier_links)
    ref_skus: list[str] = []
    for link in spec.ppa_tier_links:
        high = link.get("high_sku")
        low = link.get("low_sku")
        for sku in (high, low):
            if sku and any(b.sku == sku for b in spec.bounds) and sku not in ref_skus:
                ref_skus.append(sku)
    if len(ref_skus) > 1:
        blocks.append(ref_skus)

    # 2. Within-tier size chains (each chain is its own block)
    for chain in spec.ppa_size_chains:
        c = [s for s in chain if any(b.sku == s for b in spec.bounds)]
        if len(c) > 1 and c not in blocks:
            blocks.append(c)

    # 3. Any independent SKUs not covered by multi-SKU blocks
    covered = set()
    for b in blocks:
        covered.update(b)

    for b in spec.bounds:
        if b.sku not in covered:
            blocks.append([b.sku])
            covered.add(b.sku)

    if not blocks:
        blocks = [[b.sku] for b in spec.bounds]

    return blocks


def _subsample_block_menus(
    block: list[str],
    menus: dict[str, list[float]],
    current_prices: dict[str, float],
) -> list[list[float]]:
    k = len(block)
    if k <= 2:
        target_n = 15
    elif k == 3:
        target_n = 8
    elif k == 4:
        target_n = 5
    else:
        target_n = 4

    out: list[list[float]] = []
    for sku in block:
        m = menus.get(sku, [])
        if len(m) <= target_n:
            out.append(list(m))
            continue
        curr = current_prices.get(sku)
        idxs = list(np.round(np.linspace(0, len(m) - 1, target_n)).astype(int))
        if curr is not None:
            nearest_idx = min(range(len(m)), key=lambda i: abs(m[i] - curr))
            idxs.append(nearest_idx)
        selected = sorted({m[i] for i in idxs})
        out.append(selected)
    return out


def optimize_coordinate_ascent(
    project: ProjectCore,
    spec: OptSpec,
    *,
    on_eval: Callable[[int, float], None] | None = None,
) -> OptResult:
    """
    Menu-based coordinate ascent with multi-start.
    """
    fast_eval = _try_create_fast_evaluator(project, spec)
    max_menu = 15 if fast_eval else 5
    menus, preflight_conflicts = _build_menus(spec, max_menu=max_menu)
    
    base_prices = {b.sku: b.base_price for b in spec.bounds}
    ctr: list[int] = [0, 0]
    hist: list[float] = []
    
    baseline_raw = _eval(project, spec, base_prices, ctr, on_eval, fast_eval, skip_constraints=False)
    baseline = _ensure_finite_baseline(project, spec, base_prices, baseline_raw)
    
    if preflight_conflicts or any(not menus[b.sku] for b in spec.bounds):
        return _finalize_opt(
            project,
            spec,
            prices=base_prices,
            baseline_value=baseline,
            base_prices=base_prices,
            n_evals=ctr[0],
            obj_history=[baseline],
            sweep_data=None,
            infeasible_trials=ctr[1],
            found_feasible=False,
            preflight_conflicts=preflight_conflicts,
            menus=menus,
        )
        
    blocks = _get_blocks(spec)
    if spec.multi_start == "current":
        starts = _generate_starts(spec, menus, n_random=0)[:1]
    else:
        starts = _generate_starts(spec, menus, n_random=1 if fast_eval else 0)
        if not fast_eval:
            starts = starts[:1]

    max_passes = spec.max_iters if fast_eval else 2
    
    cache: dict[tuple, float] = {}
    
    def score(prices: dict[str, float]) -> float:
        key = tuple(prices[b.sku] for b in spec.bounds)
        if key in cache:
            return cache[key]
        # Keep commercial constraints on (margin/corridor/PPA). Menus are built to
        # satisfy them after cent rounding, but skip_constraints=True previously
        # let rounded-below-floor prices win and then fail in finalize.
        val = _eval(project, spec, prices, ctr, on_eval, fast_eval, skip_constraints=False)
        cache[key] = val
        return val
        
    best_overall_val = float("-inf")
    best_overall_prices = dict(base_prices)
    found_feasible = False
    
    for start in starts:
        x = dict(start)
        v = score(x)
        
        for _pass in range(max_passes):
            improved = False
            
            for block in blocks:
                import itertools
                block_menus = _subsample_block_menus(block, menus, x)
                best_block_val = v
                best_block_x = dict(x)
                
                for combo in itertools.product(*block_menus):
                    trial = dict(x)
                    for sku, p in zip(block, combo):
                        trial[sku] = p
                        
                    if len(block) > 1 and not _ppa_ladder_ok(spec, trial):
                        continue
                        
                    t = score(trial)
                    if math.isfinite(t) and t > best_block_val + spec.tol:
                        best_block_val = t
                        best_block_x = dict(trial)
                        improved = True
                        
                if improved:
                    v = best_block_val
                    x = dict(best_block_x)
                    
            if not improved:
                break
                
        if math.isfinite(v) and v > best_overall_val:
            best_overall_val = v
            best_overall_prices = dict(x)
            found_feasible = True
            
        hist.append(v if math.isfinite(v) else baseline)
        
    sweep = (
        _sweep_1sku(project, spec, best_overall_prices, ctr, fast_eval=fast_eval)
        if len(spec.bounds) == 1 and found_feasible
        else None
    )

    return _finalize_opt(
        project,
        spec,
        prices=best_overall_prices,
        baseline_value=baseline,
        base_prices=base_prices,
        n_evals=ctr[0],
        obj_history=hist,
        sweep_data=sweep,
        infeasible_trials=ctr[1],
        found_feasible=found_feasible,
        menus=menus,
    )

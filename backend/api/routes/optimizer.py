"""Brand Price Optimizer routes."""

from __future__ import annotations

import csv
import io
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from api.deps import get_current_client_id
from api.schemas import CorridorPreviewRequest, RunOptimizerRequest, SaveOptimizerScenarioRequest
from api.study_access import ensure_study_access
from api.serializers import dataframe_to_records, segmentation_payload
from data.scenario_store import ScenarioStore
from data.unit_costs import load_unit_cost_overrides, resolve_unit_cost
from model.corridor_preview import corridor_preview
from model.optimizer import (
    OptResult,
    OptSpec,
    PriceBound,
    apply_competitor_price_moves,
    build_optimizer_context,
    estimate_evals,
    get_calibrated_bounds,
    get_optimizer_groups,
    get_sku_size,
    optimize_coordinate_ascent,
    sort_skus_by_size,
)
from model.project_core import ProjectCore


router = APIRouter(prefix="/api/{slug}/optimizer", tags=["optimizer"])


@dataclass
class JobRecord:
    job_id: str
    slug: str
    client_id: str
    status: str  # "running" | "done" | "cancelled" | "error"
    evals: int = 0
    estimated_evals: int = 100
    best_obj: float = 0.0
    result: OptResult | None = None
    error: str | None = None
    request: RunOptimizerRequest | None = None
    cancel_event: threading.Event = field(default_factory=threading.Event)


def _bound_hit(optimal: float, lo: float, hi: float) -> str | None:
    """Return 'min' or 'max' when optimal price is at a search bound (within tolerance)."""
    if lo <= 0 or hi <= 0:
        return None
    tol = max(0.05, optimal * 0.002)
    if abs(optimal - lo) <= tol:
        return "min"
    if abs(optimal - hi) <= tol:
        return "max"
    return None


def _pct_points_to_fraction(value: float | None) -> float | None:
    """Convert UI percent points (34 = 34%) to an internal fraction (0.34)."""
    if value is None:
        return None
    return float(value) / 100.0


def _get_project(slug: str, client_id: str) -> ProjectCore:
    ensure_study_access(client_id, slug)
    project = ProjectCore(slug, client_id=client_id)
    project.initialize()
    return project


def _brand_skus(project: ProjectCore, group_type: str, brand: str) -> list[str]:
    from model.offer_type_filter import filter_standalone_offer_skus

    names = get_optimizer_groups(project, group_type).get(brand, [])
    if project.doc is None:
        return names
    return filter_standalone_offer_skus(project.doc, names)


def _standalone_allowed_skus(project: ProjectCore, skus: list[str]) -> set[str]:
    from model.offer_type_filter import filter_standalone_offer_skus

    if project.doc is None:
        return set(skus)
    return set(filter_standalone_offer_skus(project.doc, skus))


def _parse_filters_json(
    filters: str | None,
    assignment_key: str | None,
    member: str | None,
) -> list:
    if filters:
        import json

        try:
            raw = json.loads(filters)
            from api.schemas import SegmentFilter

            return [SegmentFilter(**item) for item in raw]
        except (json.JSONDecodeError, TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=f"Invalid filters: {exc}") from exc
    return []


def _parse_segment_filters(
    assignment_key: str | None,
    member: str | None,
    filters: list | None,
) -> list[tuple[str, str]]:
    if filters:
        return [(f.assignment_key, f.member) for f in filters]
    if assignment_key and member:
        return [(assignment_key, member)]
    return []


def _prepare_optimizer_project(
    slug: str,
    *,
    client_id: str,
    assignment_key: str | None = None,
    member: str | None = None,
    filters: list | None = None,
    base_scenario: str | None = None,
    group_type: str | None = None,
    competitor_moves: list | None = None,
    skip_brands: list[str] | None = None,
) -> ProjectCore:
    """Load study base or a saved scenario, then apply segment filter(s)."""
    project = _get_project(slug, client_id)
    if base_scenario:
        store = ScenarioStore(slug, client_id)
        try:
            scenario = store.load(base_scenario)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        project.apply_scenario(scenario)
    else:
        project.reset_products()
    seg = _parse_segment_filters(assignment_key, member, filters)
    if seg:
        project.apply_segmentation_filters(seg)
    if competitor_moves and group_type:
        apply_competitor_price_moves(
            project,
            group_type,
            competitor_moves,
            skip_brands=set(skip_brands or ()),
        )
    return project


def _setup_from_request(req: RunOptimizerRequest) -> dict:
    return {
        "assignment_key": req.assignment_key,
        "member": req.member,
        "filters": req.filters,
        "base_scenario": req.base_scenario,
        "group_type": getattr(req, "group_type", None),
        "competitor_moves": getattr(req, "competitor_moves", None),
        "skip_brands": [req.brand] if getattr(req, "brand", None) else None,
    }


def _price_from_row(row: pd.Series) -> float:
    """Scenario starting price: New Price when set, else Base Price."""
    for key in ("New Price", "Base Price", "Price"):
        if key not in row.index:
            continue
        try:
            val = float(row[key])
            if val > 0:
                return val
        except (TypeError, ValueError):
            continue
    return 0.0


def _current_price(row: pd.Series) -> float:
    return _price_from_row(row)


def _apply_optimal_prices(project: ProjectCore, prices: dict[str, float]) -> None:
    for sku, price in prices.items():
        project.change_product_attribute(sku, "Price", str(price), reload=False)
    project.find_predicted_shares()


def _row_float(row: pd.Series, *keys: str, default: float = 0.0) -> float:
    import math
    for key in keys:
        if key in row.index:
            try:
                val = float(row[key] if row[key] is not None else default)
                if math.isfinite(val):
                    return val
            except (TypeError, ValueError):
                pass
    return default


def _build_sku_rows(
    base_df: pd.DataFrame,
    final_df: pd.DataFrame,
    brand_skus: list[str],
    result: OptResult,
    req: RunOptimizerRequest,
) -> list[dict]:
    bound_by_sku = {b.sku: b for b in req.bounds}
    rows: list[dict] = []

    for sku in brand_skus:
        base_r = base_df[base_df["Product Name"] == sku]
        final_r = final_df[final_df["Product Name"] == sku]
        if base_r.empty or final_r.empty:
            continue
        b = base_r.iloc[0]
        f = final_r.iloc[0]
        bound = bound_by_sku.get(sku)

        base_price = _price_from_row(b)
        opt_price = float(result.prices.get(sku, base_price))
        lo = float(bound.lo) if bound else base_price
        hi = float(bound.hi) if bound else base_price

        base_share = _row_float(b, "N.Share", "B.Share")
        new_share = _row_float(f, "N.Share")
        base_rev = _row_float(b, "Revenue")
        new_rev = _row_float(f, "Revenue")
        base_val = _row_float(b, "Value Share")
        new_val = _row_float(f, "Value Share")

        price_delta_pct = ((opt_price - base_price) / base_price * 100.0) if base_price else 0.0
        rev_delta_pct = ((new_rev - base_rev) / base_rev * 100.0) if base_rev else 0.0

        rows.append({
            "name": sku,
            "optimized": sku in result.prices,
            "base_price": base_price,
            "optimal_price": opt_price,
            "raw_price": float(result.raw_prices.get(sku, opt_price)) if result.raw_prices else opt_price,
            "lo": lo,
            "hi": hi,
            "price_delta_pct": price_delta_pct,
            "bound_hit": _bound_hit(opt_price, lo, hi) if bound else None,
            "limited_by": (result.limited_by or {}).get(sku) if sku in result.prices else None,
            "base_vol_share": base_share,
            "new_vol_share": new_share,
            "share_delta_pp": new_share - base_share,
            "base_rev": base_rev,
            "new_rev": new_rev,
            "rev_delta_pct": rev_delta_pct,
            "base_val_share": base_val,
            "new_val_share": new_val,
        })
    return rows


def _build_cannibalization(
    base_df: pd.DataFrame,
    final_df: pd.DataFrame,
    brand_skus: list[str],
    brand_label: str,
) -> dict:
    all_prods = base_df["Product Name"].astype(str).tolist()
    competitor_prods = [p for p in all_prods if p not in brand_skus]

    brand_base_vol = float(base_df[base_df["Product Name"].isin(brand_skus)]["N.Share"].sum())
    brand_new_vol = float(final_df[final_df["Product Name"].isin(brand_skus)]["N.Share"].sum())
    comp_base_vol = float(base_df[base_df["Product Name"].isin(competitor_prods)]["N.Share"].sum())
    comp_new_vol = float(final_df[final_df["Product Name"].isin(competitor_prods)]["N.Share"].sum())

    groups = [
        {
            "group": brand_label,
            "base_vol_share": brand_base_vol,
            "optimal_vol_share": brand_new_vol,
            "change_pp": brand_new_vol - brand_base_vol,
        },
        {
            "group": "Competitors",
            "base_vol_share": comp_base_vol,
            "optimal_vol_share": comp_new_vol,
            "change_pp": comp_new_vol - comp_base_vol,
        },
    ]

    top_losers: list[dict] = []
    for sku in competitor_prods:
        br = base_df[base_df["Product Name"] == sku]
        fr = final_df[final_df["Product Name"] == sku]
        if br.empty or fr.empty:
            continue
        bs = _row_float(br.iloc[0], "N.Share", "B.Share")
        ns = _row_float(fr.iloc[0], "N.Share")
        top_losers.append({
            "name": sku,
            "base": bs,
            "optimal": ns,
            "delta_pp": ns - bs,
        })
    top_losers.sort(key=lambda r: r["delta_pp"])

    return {"groups": groups, "top_losers": top_losers[:10]}


def _brand_cm_pct_unit_cost(
    df: pd.DataFrame,
    brand_skus: list[str],
    cost_by_sku: dict[str, float],
) -> float | None:
    """Revenue-weighted brand CM% from unit costs: Σ rev×(p−c)/p / Σ rev."""
    if "Product Name" not in df.columns:
        return None
    subset = df[df["Product Name"].isin(brand_skus)]
    tot_rev = 0.0
    tot_contrib = 0.0
    for _, row in subset.iterrows():
        sku = str(row["Product Name"])
        rev = _row_float(row, "Revenue")
        price = _price_from_row(row)
        if rev <= 0 or price <= 0:
            continue
        cost = float(cost_by_sku.get(sku, 0.0))
        tot_rev += rev
        tot_contrib += rev * max(price - cost, 0.0) / price
    if tot_rev <= 0:
        return None
    return tot_contrib / tot_rev * 100.0


def _build_brand_totals(
    base_df: pd.DataFrame,
    final_df: pd.DataFrame,
    brand_skus: list[str],
    cost_by_sku: dict[str, float] | None = None,
) -> dict:
    b = base_df[base_df["Product Name"].isin(brand_skus)]
    f = final_df[final_df["Product Name"].isin(brand_skus)]
    tot_base_rev = float(b["Revenue"].sum()) if "Revenue" in b.columns else 0.0
    tot_new_rev = float(f["Revenue"].sum()) if "Revenue" in f.columns else 0.0
    tot_base_vol = float(b["N.Share"].sum()) if "N.Share" in b.columns else 0.0
    tot_new_vol = float(f["N.Share"].sum()) if "N.Share" in f.columns else 0.0
    tot_base_val = float(b["Value Share"].sum()) if "Value Share" in b.columns else 0.0
    tot_new_val = float(f["Value Share"].sum()) if "Value Share" in f.columns else 0.0
    out = {
        "base_rev": tot_base_rev,
        "new_rev": tot_new_rev,
        "rev_delta_pct": ((tot_new_rev - tot_base_rev) / tot_base_rev * 100.0) if tot_base_rev else 0.0,
        "base_vol": tot_base_vol,
        "new_vol": tot_new_vol,
        "vol_delta_pp": tot_new_vol - tot_base_vol,
        "base_val": tot_base_val,
        "new_val": tot_new_val,
        "val_delta_pp": tot_new_val - tot_base_val,
    }
    costs = cost_by_sku or {}
    base_cm_pct = _brand_cm_pct_unit_cost(base_df, brand_skus, costs)
    new_cm_pct = _brand_cm_pct_unit_cost(final_df, brand_skus, costs)
    if base_cm_pct is not None and new_cm_pct is not None:
        out["base_cm_pct"] = base_cm_pct
        out["new_cm_pct"] = new_cm_pct
        out["cm_delta_pp"] = new_cm_pct - base_cm_pct
    return out


def _build_result_payload(
    slug: str, res: OptResult, req: RunOptimizerRequest, client_id: str
) -> dict:
    setup = _setup_from_request(req)
    project = _prepare_optimizer_project(slug, client_id=client_id, **setup)
    if project.results is None or project.results.empty:
        project.reload_results()
    base_df = project.results.copy()

    _apply_optimal_prices(project, res.prices)
    final_df = project.results.copy()

    brand_skus = _brand_skus(project, req.group_type, req.brand)
    sku_rows = _build_sku_rows(base_df, final_df, brand_skus, res, req)

    market_rows = []
    for _, row in final_df.iterrows():
        name = str(row.get("Product Name", ""))
        base_r = base_df[base_df["Product Name"] == name]
        base_val = (
            _row_float(base_r.iloc[0], "Value Share") if not base_r.empty else 0.0
        )
        market_rows.append({
            "name": name,
            "new_price": _price_from_row(row),
            "b_share": _row_float(row, "B.Share"),
            "n_share": _row_float(row, "N.Share"),
            "s_index": _row_float(row, "S.Index"),
            "revenue": _row_float(row, "Revenue"),
            "r_index": _row_float(row, "R.Index"),
            "base_val_share": base_val,
            "value_share": _row_float(row, "Value Share"),
        })

    return {
        "prices": res.prices,
        "objective_value": res.objective_value,
        "baseline_value": res.baseline_value,
        "uplift_pct": res.uplift_pct,
        "n_evals": res.n_evals,
        "obj_history": res.obj_history,
        "sweep_data": res.sweep_data,
        "baseline_brand_volume": res.baseline_brand_volume,
        "final_brand_volume": res.final_brand_volume,
        "brand_volume_drop_pct": res.brand_volume_drop_pct,
        "max_volume_drop_pct": res.max_volume_drop_pct,
        "corridor_ratio": res.corridor_ratio,
        "binding_constraints": res.binding_constraints,
        "infeasible_trials": res.infeasible_trials,
        "base_prices_violate_constraints": res.base_prices_violate_constraints,
        "solution_status": res.solution_status,
        "constraint_conflicts": res.constraint_conflicts,
        "limited_by": res.limited_by,
        "ppa_ladder_rows": res.ppa_ladder_rows,
        "raw_prices": res.raw_prices,
        "duration_ms": res.duration_ms,
        "n_passes": res.n_passes,
        "algorithm": res.algorithm,
        "menus": res.menus,
        "reference_sku": getattr(req, "reference_sku", None),
        "anchor_label": getattr(req, "anchor_label", None),
        "anchor_price": getattr(req, "anchor_price", None),
        "corridor_basis": getattr(req, "corridor_basis", "pack"),
        "corridor_min": getattr(req, "corridor_min", None),
        "corridor_max": getattr(req, "corridor_max", None),
        "enforce_ppa_ladder": getattr(req, "enforce_ppa_ladder", False),
        "min_margin_pct": getattr(req, "min_margin_pct", None),
        "market_rows": market_rows,
        "scenario_columns": [str(c) for c in final_df.columns],
        "scenario_results": dataframe_to_records(final_df),
        "sku_rows": sku_rows,
        "brand_totals": _build_brand_totals(
            base_df,
            final_df,
            brand_skus,
            {b.sku: float(b.cost) for b in req.bounds},
        ),
        "cannibalization": _build_cannibalization(base_df, final_df, brand_skus, req.brand),
        "segmentation": segmentation_payload(project),
        "base_scenario": req.base_scenario,
        "competitor_moves": [
            {"brand": m.brand, "pct": m.pct}
            if hasattr(m, "brand")
            else m
            for m in (getattr(req, "competitor_moves", None) or [])
        ],
    }


_jobs: dict[str, JobRecord] = {}
_executor = ThreadPoolExecutor(max_workers=2)


def _persist_job(job: JobRecord) -> None:
    from db.repository import OptimizerJobRepository

    client_id = job.client_id
    study_id = OptimizerJobRepository().study_id_for_slug(client_id, job.slug)
    if not study_id:
        return
    OptimizerJobRepository().upsert(
        job.job_id,
        client_id,
        study_id,
        status=job.status,
        evals=job.evals,
        estimated_evals=job.estimated_evals,
        best_obj=job.best_obj,
        error=job.error,
    )


def _memory_job(slug: str, job_id: str, client_id: str) -> JobRecord:
    job = _jobs.get(job_id)
    if job is None or job.client_id != client_id or job.slug != slug:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/context")
def get_context(slug: str, client_id: str = Depends(get_current_client_id)) -> dict:
    project = _get_project(slug, client_id)
    ctx = build_optimizer_context(project)
    ctx["segmentation"] = segmentation_payload(project)
    ctx["scenarios"] = ScenarioStore(slug, client_id).list_scenarios()
    return ctx


def _brand_summary_payload(
    project: ProjectCore,
    slug: str,
    group_type: str,
    brand: str,
    *,
    base_scenario: str | None = None,
) -> dict:
    """SKU list + KPIs for one brand from an already-prepared project."""
    if project.results is None or project.results.empty:
        project.reload_results()
    df = project.results

    brand_skus = _brand_skus(project, group_type, brand)
    cost_overrides = load_unit_cost_overrides(slug, project.client_id)
    products_by_name = {p.name: p for p in project.doc.products} if project.doc else {}

    skus_count = 0
    volume_share = 0.0
    revenue = 0.0
    value_share = 0.0
    sku_list = []

    for name in brand_skus:
        matches = df[df["Product Name"] == name]
        if matches.empty:
            continue
        row = matches.iloc[0]
        skus_count += 1
        n_share = float(row.get("N.Share", 0.0))
        b_share = float(row.get("B.Share", 0.0))
        rev = float(row.get("Revenue", 0.0))
        val_share = float(row.get("Value Share", 0.0))
        base_price = _current_price(row)
        product = products_by_name.get(name)
        if "Selected" in row.index:
            included = bool(row.get("Selected", True))
        elif product is not None:
            included = product.included
        else:
            included = True

        volume_share += n_share
        revenue += rev
        value_share += val_share

        sku_list.append({
            "name": name,
            "base_price": base_price,
            "b_share": b_share,
            "n_share": n_share,
            "revenue": rev,
            "value_share": val_share,
            # Unit size drives the €/L view; None when the study has no size attribute.
            "size": get_sku_size(project.doc, name),
            "unit_cost": resolve_unit_cost(slug, name, base_price, cost_overrides),
            "included": included,
        })

    return {
        "kpis": {
            "skus_count": skus_count,
            "volume_share": volume_share,
            "revenue": revenue,
            "value_share": value_share,
        },
        "skus": sku_list,
        "segmentation": segmentation_payload(project),
        "base_scenario": base_scenario,
    }


@router.get("/brand-summary")
def get_brand_summary(
    slug: str,
    group_type: str,
    brand: str,
    assignment_key: str | None = None,
    member: str | None = None,
    filters: str | None = None,
    base_scenario: str | None = None,
    client_id: str = Depends(get_current_client_id),
) -> dict:
    filt = _parse_filters_json(filters, assignment_key, member)
    project = _prepare_optimizer_project(
        slug,
        client_id=client_id,
        assignment_key=assignment_key,
        member=member,
        filters=filt or None,
        base_scenario=base_scenario,
    )
    return _brand_summary_payload(
        project, slug, group_type, brand, base_scenario=base_scenario
    )


@router.get("/brand-summaries")
def get_brand_summaries(
    slug: str,
    group_type: str,
    assignment_key: str | None = None,
    member: str | None = None,
    filters: str | None = None,
    base_scenario: str | None = None,
    client_id: str = Depends(get_current_client_id),
) -> dict:
    """All brand SKU lists from a single study load (avoids N× initialize() on the optimizer page)."""
    filt = _parse_filters_json(filters, assignment_key, member)
    project = _prepare_optimizer_project(
        slug,
        client_id=client_id,
        assignment_key=assignment_key,
        member=member,
        filters=filt or None,
        base_scenario=base_scenario,
    )
    groups = get_optimizer_groups(project, group_type)
    if project.results is None or project.results.empty:
        project.reload_results()
    brands = {
        brand: _brand_summary_payload(
            project, slug, group_type, brand, base_scenario=base_scenario
        )
        for brand in groups
    }
    return {
        "brands": brands,
        "segmentation": segmentation_payload(project),
        "base_scenario": base_scenario,
    }


@router.get("/bounds")
def get_bounds(
    slug: str,
    group_type: str,
    brand: str,
    assignment_key: str | None = None,
    member: str | None = None,
    filters: str | None = None,
    base_scenario: str | None = None,
    client_id: str = Depends(get_current_client_id),
) -> list[dict]:
    filt = _parse_filters_json(filters, assignment_key, member)
    project = _prepare_optimizer_project(
        slug,
        client_id=client_id,
        assignment_key=assignment_key,
        member=member,
        filters=filt or None,
        base_scenario=base_scenario,
    )
    doc = project.doc
    if project.results is None or project.results.empty:
        project.reload_results()
    df = project.results

    brand_skus = _brand_skus(project, group_type, brand)

    price_by_name: dict[str, float] = {}
    for _, row in df.iterrows():
        name = str(row.get("Product Name", ""))
        if name not in brand_skus:
            continue
        raw = _price_from_row(row)
        if raw > 0:
            price_by_name[name] = raw

    products_by_name = {p.name: p for p in doc.products}
    cost_overrides = load_unit_cost_overrides(slug, project.client_id)
    sku_rows = []
    for sku in brand_skus:
        p = products_by_name.get(sku)
        if p is None:
            continue
        raw_price = price_by_name.get(p.name, p.base_attributes.get("Price", 0.0))
        try:
            base_price = float(raw_price or 0.0)
        except (TypeError, ValueError):
            base_price = 0.0
        lo, hi = get_calibrated_bounds(doc, p.product_id, base_price)
        sku_rows.append({
            "sku": p.name,
            "base_price": base_price,
            "lo": lo,
            "hi": hi,
            "cost": resolve_unit_cost(slug, p.name, base_price, cost_overrides),
        })
    return sku_rows


@router.post("/corridor-preview")
def post_corridor_preview(
    slug: str,
    body: CorridorPreviewRequest,
    client_id: str = Depends(get_current_client_id),
) -> dict:
    """Sweep focus reference SKU price vs anchor; return contribution/volume curves + bounds."""
    project = _prepare_optimizer_project(
        slug,
        client_id=client_id,
        assignment_key=body.assignment_key,
        member=body.member,
        filters=body.filters,
        base_scenario=body.base_scenario,
        group_type=body.group_type,
        competitor_moves=body.competitor_moves,
        skip_brands=[body.brand] if body.brand else None,
    )
    try:
        payload = corridor_preview(
            project,
            group_type=body.group_type,
            brand=body.brand,
            reference_sku=body.reference_sku,
            anchor_price=body.anchor_price,
            anchor_label=body.anchor_label,
            anchor_sku=body.anchor_sku,
            index_min=body.index_min,
            index_max=body.index_max,
            index_step=body.index_step,
            n_points=body.n_points,
            min_margin_pct=body.min_margin_pct,
            max_volume_drop_pct=body.max_volume_drop_pct,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    payload["segmentation"] = segmentation_payload(project)
    payload["base_scenario"] = body.base_scenario
    payload["competitor_moves"] = [
        {"brand": m.brand, "pct": m.pct} for m in (body.competitor_moves or [])
    ]
    return payload


def _run_job(job: JobRecord, req: RunOptimizerRequest) -> None:
    from api.context import current_client_id

    context_token = current_client_id.set(job.client_id)
    try:
        setup = _setup_from_request(req)
        project = _prepare_optimizer_project(job.slug, client_id=job.client_id, **setup)

        allowed = _standalone_allowed_skus(
            project, [b.sku for b in req.bounds if b.included]
        )
        included = [b for b in req.bounds if b.included and b.sku in allowed]
        ordered_skus = sort_skus_by_size(project.doc, [b.sku for b in included])
        included_bounds = {b.sku: b for b in included}
        bounds = []
        for sku in ordered_skus:
            b = included_bounds[sku]
            # Re-read current price from prepared project (scenario may have changed prices).
            row = project.results[project.results["Product Name"] == b.sku]
            base_price = _current_price(row.iloc[0]) if not row.empty else b.base_price
            bounds.append(PriceBound(
                sku=b.sku,
                base_price=base_price,
                lo=b.lo,
                hi=b.hi,
                cost=b.cost,
            ))

        if req.scope == "brand":
            scope_skus = _brand_skus(project, req.group_type, req.brand)
        else:
            scope_skus = [b.sku for b in included]

        # Reference SKU / competitive anchor / price corridor. The anchor is
        # typically a competitor SKU outside the study, so its price and (for
        # unit-basis corridors) its unit size are supplied directly by the
        # caller rather than looked up in the study data. Fields are read via
        # getattr so older/lightweight request objects (e.g. in tests) that
        # predate this section still work with their implicit defaults.
        reference_sku = getattr(req, "reference_sku", None)
        reference_size = get_sku_size(project.doc, reference_sku) if reference_sku else None
        anchor_size = getattr(req, "anchor_size", None)

        # Pack Price Architecture — enforce a size-ordered ladder over decision SKUs.
        ppa_size_chains: list[list[str]] = []
        ppa_tier_links: list[dict] = []
        ppa_sizes: dict[str, float] = {}
        if getattr(req, "enforce_ppa_ladder", False):
            client_chains = getattr(req, "ppa_size_chains", None)
            if client_chains is not None:
                # Explicit payload (may be [] when size ladder is off; tier links only).
                ppa_size_chains = client_chains
                all_ppa_skus: set[str] = set()
                for chain in ppa_size_chains:
                    all_ppa_skus.update(chain)
                if getattr(req, "ppa_tier_links", None):
                    ppa_tier_links = [
                        link.dict() if hasattr(link, "dict") else link
                        for link in req.ppa_tier_links
                    ]
                    for link in ppa_tier_links:
                        if link.get("high_sku"):
                            all_ppa_skus.add(link["high_sku"])
                        if link.get("low_sku"):
                            all_ppa_skus.add(link["low_sku"])
                for sku in all_ppa_skus:
                    size = get_sku_size(project.doc, sku)
                    if size is not None:
                        ppa_sizes[sku] = size
            else:
                # Legacy clients without ppa_size_chains — single chain over all SKUs.
                ppa_size_chains = [ordered_skus]
                for sku in ordered_skus:
                    size = get_sku_size(project.doc, sku)
                    if size is not None:
                        ppa_sizes[sku] = size

        spec = OptSpec(
            bounds=bounds,
            objective=req.objective,
            scope_skus=scope_skus,
            max_iters=req.max_iters,
            multi_start=getattr(req, "multi_start", "full"),
            tol=float(req.tol_str),
            grid_points=req.grid_points,
            max_volume_drop_pct=req.max_volume_drop_pct,
            reference_sku=reference_sku,
            anchor_label=getattr(req, "anchor_label", None),
            anchor_price=getattr(req, "anchor_price", None),
            corridor_basis=getattr(req, "corridor_basis", "pack"),
            corridor_min=getattr(req, "corridor_min", None),
            corridor_max=getattr(req, "corridor_max", None),
            reference_size=reference_size,
            anchor_size=anchor_size,
            ppa_size_chains=ppa_size_chains,
            ppa_tier_links=ppa_tier_links,
            ppa_sizes=ppa_sizes,
            ppa_min_saving=getattr(req, "ppa_min_saving", None),
            ppa_max_saving=getattr(req, "ppa_max_saving", None),
            min_margin_pct=_pct_points_to_fraction(getattr(req, "min_margin_pct", None)),
        )

        import time as _time
        t0 = _time.perf_counter()

        def on_eval(n: int, val: float) -> None:
            job.evals = n
            job.best_obj = max(job.best_obj, val)
            _persist_job(job)
            if job.cancel_event.is_set():
                raise InterruptedError("cancelled")

        res = optimize_coordinate_ascent(project, spec, on_eval=on_eval)

        res.duration_ms = (_time.perf_counter() - t0) * 1000.0
        res.algorithm = req.algorithm
        job.result = res
        job.status = "done"
    except InterruptedError:
        job.status = "cancelled"
    except Exception as e:
        job.status = "error"
        job.error = str(e)
    finally:
        try:
            _persist_job(job)
        finally:
            current_client_id.reset(context_token)


@router.post("/run")
def run_optimizer(
    slug: str,
    body: RunOptimizerRequest,
    client_id: str = Depends(get_current_client_id),
) -> dict:
    ensure_study_access(client_id, slug)
    job_id = uuid.uuid4().hex

    bounds = [PriceBound(b.sku, b.base_price, b.lo, b.hi, b.cost) for b in body.bounds if b.included]
    spec = OptSpec(bounds=bounds, objective=body.objective, scope_skus=[])
    est_evals = estimate_evals(spec, body.algorithm)

    job = JobRecord(
        job_id=job_id,
        slug=slug,
        client_id=client_id,
        status="running",
        estimated_evals=est_evals,
        request=body,
    )
    _jobs[job_id] = job
    _persist_job(job)

    _executor.submit(_run_job, job, body)

    return {
        "job_id": job_id,
        "estimated_evals": est_evals,
    }


@router.get("/jobs/{job_id}")
def get_job(slug: str, job_id: str, client_id: str = Depends(get_current_client_id)) -> dict:
    if job_id not in _jobs:
        from db.repository import OptimizerJobRepository

        row = OptimizerJobRepository().get(job_id, client_id)
        if not row or row.get("slug") != slug:
            raise HTTPException(status_code=404, detail="Job not found")
        row.pop("slug", None)
        return {**row, "result": None}

    job = _memory_job(slug, job_id, client_id)
    payload = {
        "status": job.status,
        "evals": job.evals,
        "estimated_evals": job.estimated_evals,
        "best_obj": job.best_obj,
        "error": job.error,
        "result": None,
    }

    if job.status == "done" and job.result and job.request:
        payload["result"] = _build_result_payload(slug, job.result, job.request, client_id)
    return payload


@router.post("/jobs/{job_id}/cancel")
def cancel_job(slug: str, job_id: str, client_id: str = Depends(get_current_client_id)) -> dict:
    job = _memory_job(slug, job_id, client_id)
    if job.status == "running":
        job.cancel_event.set()
        job.status = "cancelled"
        _persist_job(job)
    return {"ok": True}


@router.post("/jobs/{job_id}/save-scenario")
def save_scenario(
    slug: str,
    job_id: str,
    body: SaveOptimizerScenarioRequest,
    client_id: str = Depends(get_current_client_id),
) -> dict:
    job = _memory_job(slug, job_id, client_id)
    if job.status != "done" or not job.result or not job.request:
        raise HTTPException(status_code=400, detail="Job not completed")

    project = _prepare_optimizer_project(
        slug, client_id=client_id, **_setup_from_request(job.request)
    )
    _apply_optimal_prices(project, job.result.prices)

    store = ScenarioStore(slug, client_id)
    name = body.name.strip() or store.next_optimization_result_name()
    scenario = project.capture_scenario(name, body.description)
    store.save(scenario)
    return {"ok": True, "scenario_name": name}


@router.post("/jobs/{job_id}/export")
def export_results(
    slug: str,
    job_id: str,
    client_id: str = Depends(get_current_client_id),
) -> StreamingResponse:
    job = _memory_job(slug, job_id, client_id)
    if job.status != "done" or not job.result or not job.request:
        raise HTTPException(status_code=400, detail="Job not completed")

    result_payload = _build_result_payload(slug, job.result, job.request, client_id)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "SKU", "Optimized", "Base Price", "Optimal Price", "Price Δ%",
        "Base Vol.Share", "New Vol.Share", "Share Δ pp",
        "Base Revenue", "New Revenue", "Rev Δ%",
        "Base Val.Share", "New Val.Share",
    ])
    for row in result_payload["sku_rows"]:
        writer.writerow([
            row["name"],
            "Y" if row["optimized"] else "N",
            f"{row['base_price']:.4f}",
            f"{row['optimal_price']:.4f}",
            f"{row['price_delta_pct']:.2f}",
            f"{row['base_vol_share']:.4f}",
            f"{row['new_vol_share']:.4f}",
            f"{row['share_delta_pp']:.4f}",
            f"{row['base_rev']:.4f}",
            f"{row['new_rev']:.4f}",
            f"{row['rev_delta_pct']:.2f}",
            f"{row.get('base_val_share', 0):.4f}",
            f"{row.get('new_val_share', 0):.4f}",
        ])

    brand = job.request.brand.replace(" ", "_")
    filename = f"{brand}_optimized_prices.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

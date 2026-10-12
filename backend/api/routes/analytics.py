"""Chart Analysis analytics API — Phase 4b."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from api.deps import get_current_client_id
from api.study_access import require_study
from model.analytics import (
    conditional_attribute_elasticity,
    cross_brand_interaction,
    fair_share,
    incremental_gain_loss,
    price_index_and_revenues,
    som_vs_sop,
    validation_rows,
)
from model.analytics._helpers import prepare_analytics_project
router = APIRouter(prefix="/api/studies/{slug}/analytics", tags=["analytics"])

VALID_TYPES = {
    "som-sop",
    "elasticity",
    "price-index",
    "shares-revenues",
    "cross-brand",
    "fair-share",
    "validation",
    "introduction",
    "removal",
}


def _parse_filters(
    filters_json: str | None,
    assignment_key: str | None,
    member: str | None,
) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    if filters_json:
        import json

        try:
            raw = json.loads(filters_json)
            for item in raw:
                if item.get("assignment_key") and item.get("member"):
                    out.append((item["assignment_key"], item["member"]))
        except (json.JSONDecodeError, TypeError) as exc:
            raise HTTPException(status_code=400, detail=f"Invalid filters JSON: {exc}") from exc
    elif assignment_key and member:
        out.append((assignment_key, member))
    return out


@router.get("/{analysis_type}")
def get_analytics(
    analysis_type: str,
    slug: str = Depends(require_study),
    client_id: str = Depends(get_current_client_id),
    base_scenario: str | None = None,
    assignment_key: str | None = None,
    member: str | None = None,
    filters: str | None = Query(None, description="JSON array of {assignment_key, member}"),
    attribute_name: str = Query("Price"),
    product_name: str | None = Query(None, description="Limit sweep to a single SKU"),
    reference_product: str | None = None,
    scale: str | None = Query(None, description="Comma-separated price index multipliers"),
    driver_product: str | None = None,
    member_change: str | None = None,
    group_type: str = Query("Brand"),
    group_member: str | None = None,
    products: str | None = Query(None, description="Comma-separated SKU names for incremental"),
    current_lineup: str | None = Query(
        None, description="Comma-separated SKU names for incremental starting lineup"
    ),
    level: str = Query(
        "sku",
        description="sku|group|company_sku|company_group (elasticity); sku|group (fair-share/validation/cross-brand)",
    ),
    series: str | None = Query(None, description="Comma-separated series names (SKU or group)"),
    scenarios: str | None = Query(None, description="Comma-separated scenario names for validation"),
    layout: str = Query("by_scenario", description="validation: by_series|by_scenario"),
    mode: str = Query("exclusive", description="incremental: exclusive|cumulative"),
    incremental_type: str = Query("Revenue", description="cumulative metric: Revenue|Market Share|Value Share"),
    intro_order: str = Query(
        "sorted",
        description="cumulative intro order: sorted (rank by standalone share) | greedy",
    ),
) -> dict:
    atype = analysis_type.lower()
    if atype not in VALID_TYPES:
        raise HTTPException(status_code=404, detail=f"Unknown analysis type: {analysis_type}")

    seg_filters = _parse_filters(filters, assignment_key, member)
    project = prepare_analytics_project(
        slug, client_id=client_id, filters=seg_filters, base_scenario=base_scenario
    )

    if atype == "som-sop":
        data = som_vs_sop(project)
    elif atype == "elasticity":
        e_mode = level if level in ("sku", "group", "company_sku", "company_group") else "sku"
        data = conditional_attribute_elasticity(
            project,
            attribute_name,
            mode=e_mode,  # type: ignore[arg-type]
            group_type=group_type,
            product_name=product_name,
        )
    elif atype in ("price-index", "shares-revenues"):
        model = project._model
        if model is None:
            data = {"columns": [], "rows": []}
        else:
            pname = product_name or (model.company_products[0] if model.company_products else model.all_product_names[0])
            ref = reference_product or pname
            scale_vals = [s.strip() for s in scale.split(",")] if scale else None
            data = price_index_and_revenues(project, pname, ref, scale_vals)
    elif atype == "cross-brand":
        model = project._model
        if model is None:
            data = {"products": [], "scenarios": {}}
        else:
            driver = driver_product or (model.company_products[0] if model.company_products else "")
            cb_level = level if level in ("sku", "group") else "sku"
            scale_vals = None
            if scale:
                try:
                    scale_vals = [float(s.strip()) for s in scale.split(",") if s.strip()]
                except ValueError:
                    scale_vals = None
            data = cross_brand_interaction(
                project,
                driver,
                level=cb_level,  # type: ignore[arg-type]
                group_type=group_type,
                price_multipliers=scale_vals,
            )
    elif atype == "fair-share":
        model = project._model
        lvl = level if level in ("sku", "group") else "sku"
        if lvl == "group":
            members = []
            seen: set[str] = set()
            if model:
                for g in model.doc.groups:
                    if g.group_type == group_type and g.group_name not in seen:
                        seen.add(g.group_name)
                        members.append(g.group_name)
            focal = member_change or group_member or (members[0] if members else "")
        else:
            focal = member_change or (model.all_product_names[0] if model else "")
        data = fair_share(project, focal, level=lvl, group_type=group_type)  # type: ignore[arg-type]
    elif atype == "validation":
        series_list = [s.strip() for s in series.split(",") if s.strip()] if series else None
        scenario_list = (
            [s.strip() for s in scenarios.split(",") if s.strip()] if scenarios else None
        )
        lvl = level if level in ("sku", "group") else "sku"
        lay = layout if layout in ("by_series", "by_scenario") else "by_scenario"
        data = validation_rows(
            project,
            level=lvl,  # type: ignore[arg-type]
            group_type=group_type,
            series=series_list,
            scenarios=scenario_list,
            layout=lay,  # type: ignore[arg-type]
            filters=seg_filters,
        )
    elif atype in ("introduction", "removal"):
        prod_list = [p.strip() for p in products.split(",") if p.strip()] if products else []
        lineup = (
            [p.strip() for p in current_lineup.split(",") if p.strip()] if current_lineup else None
        )
        gm = group_member or ""
        fn = "Intro" if atype == "introduction" else "Removal"
        m = mode if mode in ("exclusive", "cumulative") else "exclusive"
        itype = incremental_type if incremental_type in ("Revenue", "Market Share", "Value Share") else "Revenue"
        iorder = intro_order if intro_order in ("greedy", "sorted") else "sorted"
        data = incremental_gain_loss(
            project,
            fn,
            group_type,
            gm,
            prod_list,
            mode=m,  # type: ignore[arg-type]
            incremental_type=itype,  # type: ignore[arg-type]
            current_lineup=lineup,
            intro_order=iorder,  # type: ignore[arg-type]
        )
    else:
        data = []

    return {
        "type": atype,
        "slug": slug,
        "baseScenario": base_scenario,
        "filters": [{"assignment_key": k, "member": m} for k, m in seg_filters],
        "data": data,
    }

"""Convert engine DataFrames into the JSON shapes the UI consumes.

Authoritative shapes: UX_UI_SPEC.md section 9. Keep all DataFrame -> dict
coercion here so NaN handling and rounding live in one place.
"""

from __future__ import annotations

import math
from typing import Any

import pandas as pd

from config import DECIMAL_COUNT
from model.project_core import ProjectCore


def _clean_value(value: Any, decimals: int) -> Any:
    """Make a single cell JSON-safe: NaN/Inf -> None, round floats."""
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return round(value, decimals)
    # numpy scalar types expose .item()
    if hasattr(value, "item"):
        try:
            return _clean_value(value.item(), decimals)
        except (ValueError, TypeError):
            return value
    return value


def dataframe_to_records(df: pd.DataFrame, decimals: int = DECIMAL_COUNT) -> list[dict[str, Any]]:
    """Results grid rows. Columns are partly dynamic (per conditional/discrete attr)."""
    if df is None or df.empty:
        return []
    records = df.to_dict(orient="records")
    return [{k: _clean_value(v, decimals) for k, v in row.items()} for row in records]


def totals(df: pd.DataFrame, decimals: int = DECIMAL_COUNT) -> dict[str, Any]:
    """Summary metric cards (UX_UI_SPEC.md section 8.4)."""
    if df is None or df.empty:
        return {"total_n_share": None, "total_revenue": None, "total_value_share": None}

    def _sum(col: str) -> Any:
        return _clean_value(float(df[col].sum()), decimals) if col in df.columns else None

    return {
        "total_n_share": _sum("N.Share"),
        "total_revenue": _sum("Revenue"),
        "total_value_share": _sum("Value Share"),
    }


def study_context(project: ProjectCore) -> dict[str, Any]:
    """Shell study-context card (UX_UI_SPEC.md section 4.4)."""
    active = project.active_segmentation_label()
    return {
        "studyName": project.study_name,
        "companyName": project.company_name,
        "category": project.category,
        "market": project.market,
        "base": project.base,
        "products": project.product_count,
        "respondents": project.respondent_count,
        "financial": project.financial,
        "useGrouping": project.use_grouping,
        "currencySymbol": project.price_currency_symbol,
        "sizeUnitLabel": project.size_unit_label,
        "activeSegment": active,
        "filteredRespondents": project._model.filtered_respondent_count if project._model else project.respondent_count,
    }


def segmentation_payload(project: ProjectCore) -> dict[str, Any]:
    dims = project.segmentation_dimensions()
    members_by_key: dict[str, list[str]] = {}
    for _label, key in dims:
        members_by_key[key] = project.segment_members(key)

    active_filters = [
        {"assignmentKey": k, "member": m} for k, m in project.get_active_segments()
    ]
    active: dict[str, str] | None = active_filters[0] if len(active_filters) == 1 else None

    return {
        "dimensions": [{"label": label, "assignmentKey": key} for label, key in dims],
        "membersByKey": members_by_key,
        "active": active,
        "activeFilters": active_filters,
    }


def editable_columns(project: ProjectCore, df: pd.DataFrame) -> list[str]:
    """Columns the Simulator grid allows editing (matches Streamlit Runner)."""
    if df is None or df.empty:
        return []
    discrete = set(project.discrete_attributes)
    out: list[str] = []
    for col in df.columns:
        if col.startswith("New ") or col == "Selected" or col in discrete or col in ["NOS", "TDC"]:
            out.append(str(col))
    return out


def group_rows(project: ProjectCore, group_type: str = "Brand", decimals: int = DECIMAL_COUNT) -> list[dict[str, Any]]:
    """Group summary rows (UX_UI_SPEC.md section 9)."""
    rows = project.group_summary(group_type)
    cleaned: list[dict[str, Any]] = []
    for row in rows:
        out: dict[str, Any] = {}
        for k, v in row.items():
            if k == "productNames" and isinstance(v, list):
                out[k] = [str(x) for x in v]
            else:
                out[k] = _clean_value(v, decimals)
        cleaned.append(out)
    return cleaned


def discrete_attribute_levels(project: ProjectCore) -> dict[str, list[str]]:
    """Discrete attribute name -> ordered level labels (for grid dropdowns)."""
    model = project._model
    if model is None:
        return {}
    out: dict[str, list[str]] = {}
    for attr in model.doc.attributes:
        if attr.attr_type != "Discrete" or attr.is_sku or not attr.level_names:
            continue
        out[attr.name] = list(attr.level_names)
    return out


def session_payload(session_id: str, project: ProjectCore, *, slug: str = "") -> dict[str, Any]:
    """Full response for load-session and recalculate."""
    from model.attribute_bounds import attribute_bounds_payload

    df = project.results
    return {
        "sessionId": session_id,
        "slug": slug,
        "scenarioName": project.scenario_name or "",
        "study": study_context(project),
        "segmentation": segmentation_payload(project),
        "editableColumns": editable_columns(project, df),
        "columns": [str(c) for c in df.columns] if df is not None and not df.empty else [],
        # Own-vs-competitor split for grid filters (products with a Company flag).
        "companyProducts": list(project.company_products),
        "results": dataframe_to_records(df),
        "groups": group_rows(project),
        "groupTypes": project.group_types,
        "totals": totals(df),
        "attributeBounds": attribute_bounds_payload(project),
        "discreteAttributeLevels": discrete_attribute_levels(project),
    }

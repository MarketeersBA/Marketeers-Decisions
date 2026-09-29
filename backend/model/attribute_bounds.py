"""Calibrated attribute bounds for Simulator inline validation.

Reuses study conditional grids (same source as optimizer Price bounds).
Does not invent ranges beyond WD's fixed 0–100 and Price ±40% fallback.
"""

from __future__ import annotations

from typing import Any

from model.analytics._helpers import conditional_levels_for_product
from model.optimizer import get_calibrated_bounds
from model.project_core import ProjectCore
from model.study_model import StudyModel


def _numeric_level_bounds(levels: list[tuple[str, float]]) -> tuple[float, float] | None:
    vals: list[float] = []
    for _label, v in levels:
        try:
            vals.append(float(v))
        except (TypeError, ValueError):
            continue
    if len(vals) < 2:
        return None
    return float(min(vals)), float(max(vals))


def attribute_bounds_for_model(model: StudyModel) -> dict[str, dict[str, dict[str, float]]]:
    """Return {productName: {attribute: {lo, hi}}} for editable numeric attrs."""
    out: dict[str, dict[str, dict[str, float]]] = {}
    doc = model.doc

    for product in model.products:
        by_attr: dict[str, dict[str, float]] = {
            "WD": {"lo": 0.0, "hi": 100.0},
        }

        # Price: same calibration path as optimizer
        try:
            base_price = float(product.base_attributes.get("Price") or 0.0)
        except (TypeError, ValueError):
            base_price = 0.0
        if base_price <= 0:
            try:
                base_price = float(product.new_attributes.get("Price") or 0.0)
            except (TypeError, ValueError):
                base_price = 0.0
        lo, hi = get_calibrated_bounds(doc, product.product_id, base_price if base_price > 0 else 1.0)
        by_attr["Price"] = {"lo": lo, "hi": hi}

        # Other conditional attrs from level grids
        levels_by_attr = conditional_levels_for_product(model, product.name)
        for attr_name, levels in levels_by_attr.items():
            if attr_name.lower() == "price" or attr_name == "WD":
                continue
            bounds = _numeric_level_bounds(levels)
            if bounds is None:
                continue
            by_attr[attr_name] = {"lo": bounds[0], "hi": bounds[1]}

        out[product.name] = by_attr

    return out


def attribute_bounds_payload(project: ProjectCore) -> dict[str, Any]:
    if project._model is None:
        return {}
    return attribute_bounds_for_model(project._model)

"""Apply grid edits from the React Simulator to a ProjectCore session."""

from __future__ import annotations

import math

from api.schemas import GridChange
from model.project_core import ProjectCore

_MIN_PRICE = 0.01


def _product_exists(project: ProjectCore, product: str) -> bool:
    model = project._model
    return model is not None and model.get_product(product) is not None


def _current_price(project: ProjectCore, product: str) -> float:
    model = project._model
    if model is None:
        return 0.0
    p = model.get_product(product)
    if p is None:
        return 0.0
    raw = p.new_attributes.get("Price", p.base_attributes.get("Price", 0.0))
    try:
        return float(raw or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _as_bool(value: object) -> bool:
    """Coerce grid Selected values; treat common falsey strings as False."""
    if isinstance(value, str):
        s = value.strip().lower()
        if s in {"1", "true", "yes", "on"}:
            return True
        if s in {"0", "false", "no", "off", ""}:
            return False
        return False
    return bool(value)


def _normalize_price(
    project: ProjectCore, product: str, raw: str, warnings: list[str]
) -> str:
    """Expand % relative to current price, then enforce a positive floor."""
    clean = raw.strip()
    if not clean:
        return raw

    try:
        if "%" in clean:
            # Same relative semantics as AttributeEngine, resolved before the floor clamp.
            pct = float(clean.replace("%", "").strip()) / 100.0
            if not math.isfinite(pct):
                warnings.append(f"Price for {product} must be finite. Set to {_MIN_PRICE}.")
                return str(_MIN_PRICE)
            num = _current_price(project, product) * (1.0 + pct)
        else:
            num = float(clean)
    except ValueError:
        return raw

    if not math.isfinite(num):
        warnings.append(f"Price for {product} must be finite. Set to {_MIN_PRICE}.")
        return str(_MIN_PRICE)
    if num < _MIN_PRICE:
        warnings.append(f"Price for {product} cannot be < {_MIN_PRICE}. Set to {_MIN_PRICE}.")
        return str(_MIN_PRICE)
    # Pass absolute value so AttributeEngine does not re-expand a % string.
    if "%" in clean:
        return str(num)
    return clean


def apply_grid_changes(project: ProjectCore, changes: list[GridChange]) -> tuple[int, list[str]]:
    """Apply attribute / include edits. Returns (count applied, list of warnings)."""
    applied = 0
    warnings: list[str] = []
    for change in changes:
        col = change.column
        product = change.product
        value = change.value

        if not _product_exists(project, product):
            warnings.append(f"Unknown product {product!r}; change ignored.")
            continue

        if col == "Selected":
            project.include_exclude_product(product, _as_bool(value), reload=False)
            applied += 1
        elif col.startswith("New ") or col in ["NOS", "TDC"]:
            attr = col.removeprefix("New ")
            str_val = str(value)

            if attr == "WD":
                try:
                    num = float(str_val.replace("%", "").strip())
                    if num < 0:
                        warnings.append(f"WD for {product} cannot be < 0. Set to 0.")
                        str_val = "0"
                    elif num > 100:
                        warnings.append(f"WD for {product} cannot be > 100. Set to 100.")
                        str_val = "100"
                except ValueError:
                    pass
            elif attr == "Price":
                str_val = _normalize_price(project, product, str_val, warnings)

            project.change_product_attribute(product, attr, str_val, reload=False)
            applied += 1
        elif col in project.discrete_attributes:
            project.change_product_attribute(product, col, str(value), reload=False)
            applied += 1

    return applied, warnings

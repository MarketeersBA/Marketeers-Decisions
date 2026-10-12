"""Unit cost resolution for Brand Optimizer (mock or study CSV override)."""

from __future__ import annotations

import hashlib

import pandas as pd

from config import MOCK_UNIT_COST_RATIO_HI, MOCK_UNIT_COST_RATIO_LO, study_folder


def mock_cost_ratio(slug: str, sku: str) -> float:
    """Stable pseudo-random cost ratio in [lo, hi] for a study SKU."""
    lo, hi = MOCK_UNIT_COST_RATIO_LO, MOCK_UNIT_COST_RATIO_HI
    if lo > hi:
        lo, hi = hi, lo
    if lo == hi:
        return lo
    digest = hashlib.md5(f"{slug}:{sku}".encode(), usedforsecurity=False).hexdigest()
    unit = int(digest[:8], 16) / 0xFFFFFFFF
    return lo + unit * (hi - lo)


def mock_unit_cost(
    base_price: float,
    slug: str,
    sku: str,
    ratio: float | None = None,
) -> float:
    """Derive a mock unit cost from base price and a per-SKU ratio in [0.5, 0.65]."""
    if base_price <= 0:
        return 0.0
    r = mock_cost_ratio(slug, sku) if ratio is None else ratio
    return round(base_price * r, 3)


def load_unit_cost_overrides(slug: str, client_id: str | None = None) -> dict[str, float]:
    """Load optional per-SKU costs from the tenant study folder (SKU, Unit Cost)."""
    path = study_folder(slug, client_id) / "unit_costs.csv"
    if not path.is_file():
        return {}
    try:
        df = pd.read_csv(path)
    except Exception:
        return {}
    sku_col = next((c for c in df.columns if str(c).strip().lower() == "sku"), None)
    cost_col = next(
        (c for c in df.columns if str(c).strip().lower() in ("unit cost", "unit_cost", "cost")),
        None,
    )
    if sku_col is None or cost_col is None:
        return {}
    out: dict[str, float] = {}
    for _, row in df.iterrows():
        sku = str(row[sku_col]).strip()
        if not sku or sku.lower() == "nan":
            continue
        try:
            out[sku] = round(float(row[cost_col]), 3)
        except (TypeError, ValueError):
            continue
    return out


def resolve_unit_cost(
    slug: str,
    sku: str,
    base_price: float,
    overrides: dict[str, float] | None = None,
) -> float:
    """CSV override for SKU if present, otherwise mock from base price."""
    costs = overrides if overrides is not None else load_unit_cost_overrides(slug)
    if sku in costs:
        return costs[sku]
    return mock_unit_cost(base_price, slug, sku)

"""Unit costs stored on the study. Design sheet and CSV/Excel upload share one parser."""

from __future__ import annotations

import hashlib
import math
import re
from datetime import datetime, timezone
from io import BytesIO

import pandas as pd

from config import MOCK_UNIT_COST_RATIO_HI, MOCK_UNIT_COST_RATIO_LO
from model.study_schema import StudyDocument

_SKU_HEADERS = ("sku", "sku name")
_COST_HEADERS = ("unit cost", "unit_cost", "cost")
_UNIT_COST_SHEET = re.compile(r"^unit\s*costs?$", re.I)


class UnitCostImportError(ValueError):
    """The unit-cost table is present but not usable. Nothing is applied."""


def mock_cost_ratio(slug: str, sku: str) -> float:
    """Stable pseudo-random cost ratio in [lo, hi] for a study SKU.

    Used only by scripts/mock_unit_costs.py. Runtime resolution never calls this.
    """
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
    """Derive a mock unit cost from base price. Demo script only."""
    if base_price <= 0:
        return 0.0
    r = mock_cost_ratio(slug, sku) if ratio is None else ratio
    return round(base_price * r, 3)


def load_unit_cost_frame(contents: bytes, filename: str) -> pd.DataFrame:
    """Load a unit-cost table from an uploaded CSV or Excel workbook."""
    name = (filename or "").strip().lower()
    if name.endswith(".csv"):
        return pd.read_csv(BytesIO(contents))
    if name.endswith((".xlsx", ".xls")):
        xls = pd.ExcelFile(BytesIO(contents))
        sheet = next(
            (s for s in xls.sheet_names if _UNIT_COST_SHEET.search(s)),
            xls.sheet_names[0] if xls.sheet_names else None,
        )
        if sheet is None:
            raise UnitCostImportError("Unit costs workbook has no sheets.")
        return pd.read_excel(xls, sheet_name=sheet)
    raise UnitCostImportError(
        "Invalid file type. Please upload a CSV (.csv) or Excel workbook (.xlsx or .xls)."
    )


def parse_unit_cost_table(df: pd.DataFrame, known_skus: set[str]) -> dict[str, float]:
    """Parse a Unit Costs sheet, CSV, or Excel table.

    Omitted SKUs are left out of the map (uncovered, not zero). Unknown SKUs,
    duplicates, blank costs, negatives, and non-finite values reject the table.
    Fully blank rows are ignored.
    """
    if df is None:
        raise UnitCostImportError("Unit costs table is empty.")
    normalized = {str(c).strip().lower(): c for c in df.columns}
    sku_col = next((normalized[h] for h in _SKU_HEADERS if h in normalized), None)
    cost_col = next((normalized[h] for h in _COST_HEADERS if h in normalized), None)
    if sku_col is None or cost_col is None:
        raise UnitCostImportError(
            "Unit costs need columns SKU or SKU Name, and Unit Cost."
        )

    out: dict[str, float] = {}
    errors: list[str] = []
    for idx, row in df.iterrows():
        row_no = int(idx) + 2 if isinstance(idx, (int, float)) and not isinstance(idx, bool) else None
        where = f"Row {row_no}" if row_no is not None else "Row"
        sku_raw = row[sku_col]
        cost_raw = row[cost_col]
        sku_blank = pd.isna(sku_raw) or not str(sku_raw).strip() or str(sku_raw).strip().lower() == "nan"
        cost_blank = pd.isna(cost_raw) or not str(cost_raw).strip()
        if sku_blank and cost_blank:
            continue
        if sku_blank:
            errors.append(f"{where}: SKU is blank.")
            continue
        sku = str(sku_raw).strip()
        if sku not in known_skus:
            errors.append(f"{where}: unknown SKU {sku!r}.")
            continue
        if sku in out:
            errors.append(f"{where}: duplicate SKU {sku!r}.")
            continue
        if cost_blank:
            errors.append(f"{where}: Unit Cost for {sku!r} is blank.")
            continue
        try:
            cost = float(cost_raw)
        except (TypeError, ValueError):
            errors.append(f"{where}: Unit Cost for {sku!r} is not a number.")
            continue
        if not math.isfinite(cost):
            errors.append(f"{where}: Unit Cost for {sku!r} is not finite.")
            continue
        if cost < 0:
            errors.append(f"{where}: Unit Cost for {sku!r} is negative.")
            continue
        out[sku] = round(cost, 3)

    if errors:
        preview = "; ".join(errors[:8])
        more = f" (+{len(errors) - 8} more)" if len(errors) > 8 else ""
        raise UnitCostImportError(preview + more)
    return out


def apply_unit_costs(
    doc: StudyDocument,
    costs: dict[str, float],
    *,
    source: str,
    filename: str,
    updated_at: str | None = None,
) -> None:
    """Replace every product cost from ``costs``. SKUs absent from the map are uncovered."""
    for product in doc.products:
        product.unit_cost = costs.get(product.name)
    doc.meta.unit_cost_source = source
    doc.meta.unit_cost_filename = filename.strip()
    doc.meta.unit_cost_updated_at = updated_at or datetime.now(timezone.utc).isoformat()
    doc.meta.unit_cost_sku_count = sum(p.unit_cost is not None for p in doc.products)


def stored_unit_costs(doc: StudyDocument | None) -> dict[str, float]:
    """Finite stored costs keyed by SKU name. Missing products are omitted."""
    if doc is None:
        return {}
    out: dict[str, float] = {}
    for product in doc.products:
        if product.unit_cost is None:
            continue
        try:
            cost = float(product.unit_cost)
        except (TypeError, ValueError):
            continue
        if math.isfinite(cost) and cost >= 0:
            out[product.name] = cost
    return out


def resolve_unit_cost(sku: str, costs: dict[str, float] | None = None) -> float | None:
    """Stored cost for ``sku``, or None when the study does not have one."""
    if not costs:
        return None
    value = costs.get(sku)
    return None if value is None else float(value)


def missing_unit_costs(skus: list[str], costs: dict[str, float]) -> list[str]:
    seen: list[str] = []
    for sku in skus:
        if sku in costs or sku in seen:
            continue
        seen.append(sku)
    return seen


def unit_cost_gap_message(skus: list[str]) -> str:
    shown = ", ".join(skus[:12])
    extra = f" (+{len(skus) - 12} more)" if len(skus) > 12 else ""
    return (
        f"Unit cost missing for {len(skus)} SKU(s): {shown}{extra}. "
        "Upload a unit cost CSV or Excel file on Data Hub, or add a Unit Costs sheet "
        "to the design workbook."
    )


def unit_cost_provenance(doc: StudyDocument | None) -> str:
    if doc is None:
        return "no unit costs"
    source = (doc.meta.unit_cost_source or "").strip()
    name = (doc.meta.unit_cost_filename or "").strip()
    if source == "design":
        label = "design workbook Unit Costs sheet"
        return f"{label} ({name})" if name else label
    if source == "csv":
        label = "uploaded unit costs"
        return f"{label} ({name})" if name else label
    return "no unit costs"

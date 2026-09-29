"""Import scenarios from Excel workbooks (REQ-SC-01)."""

from __future__ import annotations

import re
from io import BytesIO
from typing import Any, BinaryIO

import pandas as pd

from data.scenario_store import ScenarioData


class ScenarioImportError(ValueError):
    pass


def _find_column(columns: list[str], *patterns: str) -> str | None:
    for pat in patterns:
        rx = re.compile(pat, re.I)
        for col in columns:
            if rx.search(str(col)):
                return str(col)
    return None


def _parse_scenario_sheet(df: pd.DataFrame, scenario_name: str) -> ScenarioData:
    if df.empty:
        raise ScenarioImportError(f"Sheet '{scenario_name}' is empty")

    df = df.copy()
    df.columns = [str(c).strip() for c in df.columns]

    product_col = _find_column(list(df.columns), r"product\s*name", r"^sku", r"^name$")
    if not product_col:
        raise ScenarioImportError(f"Sheet '{scenario_name}': missing Product Name column")

    wd_col = _find_column(list(df.columns), r"^wd$", r"new\s*wd")
    selected_col = _find_column(list(df.columns), r"^selected$", r"^include")

    overrides: dict[str, dict[str, Any]] = {}
    included: dict[str, bool] = {}

    for _, row in df.iterrows():
        product = str(row.get(product_col, "")).strip()
        if not product or product.lower() in ("nan", "product name", "sku name"):
            continue

        prod_overrides: dict[str, Any] = {}
        for col in df.columns:
            if col == product_col:
                continue
            if col == selected_col or col == wd_col:
                continue
            if col.startswith("New ") or col.startswith("Base "):
                attr = col.removeprefix("New ").removeprefix("Base ")
                val = row[col]
                if pd.isna(val):
                    continue
                prod_overrides[attr] = val
            elif not col.lower().startswith("b.") and col not in ("N.Share", "B.Share", "Revenue"):
                val = row[col]
                if pd.isna(val):
                    continue
                prod_overrides[col] = val

        if wd_col and pd.notna(row.get(wd_col)):
            prod_overrides["WD"] = row[wd_col]

        if prod_overrides:
            overrides[product] = {k: str(v) for k, v in prod_overrides.items()}

        if selected_col and pd.notna(row.get(selected_col)):
            raw = row[selected_col]
            if isinstance(raw, bool):
                included[product] = raw
            else:
                included[product] = str(raw).strip().lower() in ("1", "true", "yes", "y")

    return ScenarioData(
        name=scenario_name,
        description=f"Imported from Excel sheet '{scenario_name}'",
        product_overrides=overrides,
        included_products=included,
    )


def preview_scenario_import(source: BinaryIO | bytes) -> list[dict[str, Any]]:
    """Parse workbook and return preview rows without saving."""
    if isinstance(source, bytes):
        source = BytesIO(source)
    xls = pd.ExcelFile(source)
    previews: list[dict[str, Any]] = []

    for sheet in xls.sheet_names:
        if sheet.lower() in ("info", "instructions", "readme"):
            continue
        df = pd.read_excel(xls, sheet_name=sheet)
        try:
            scenario = _parse_scenario_sheet(df, sheet)
            previews.append(
                {
                    "name": scenario.name,
                    "description": scenario.description,
                    "productCount": len(scenario.product_overrides),
                    "includedCount": len(scenario.included_products),
                    "valid": True,
                    "error": None,
                }
            )
        except ScenarioImportError as exc:
            previews.append(
                {
                    "name": sheet,
                    "description": "",
                    "productCount": 0,
                    "includedCount": 0,
                    "valid": False,
                    "error": str(exc),
                }
            )
    return previews


def import_scenarios_from_excel(source: BinaryIO | bytes, *, names: list[str] | None = None) -> list[ScenarioData]:
    """Parse and return ScenarioData objects ready to save."""
    if isinstance(source, bytes):
        source = BytesIO(source)
    xls = pd.ExcelFile(source)
    selected = {n.lower() for n in names} if names else None
    out: list[ScenarioData] = []

    for sheet in xls.sheet_names:
        if sheet.lower() in ("info", "instructions", "readme"):
            continue
        if selected and sheet.lower() not in selected:
            continue
        df = pd.read_excel(xls, sheet_name=sheet)
        out.append(_parse_scenario_sheet(df, sheet))
    return out

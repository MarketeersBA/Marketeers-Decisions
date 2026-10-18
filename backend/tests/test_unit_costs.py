"""Unit cost table parsing and design-sheet import."""

from __future__ import annotations

from io import BytesIO

import pandas as pd
import pytest

from data.excel_importer import ExcelImportError, import_design_sheet
from data.unit_costs import UnitCostImportError, parse_unit_cost_table, resolve_unit_cost


def _workbook(sheets: dict[str, pd.DataFrame]) -> BytesIO:
    buf = BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        for name, frame in sheets.items():
            frame.to_excel(writer, sheet_name=name, index=False)
    buf.seek(0)
    return buf


def _products() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "SKU Name": ["Alpha", "Beta"],
            "Market Share": [10, 5],
            "WD": [100, 80],
            "Company": [1, 0],
        }
    )


def test_parse_accepts_partial_coverage_and_zero() -> None:
    frame = pd.DataFrame({"SKU": ["Alpha", "Beta"], "Unit Cost": [1.5, 0]})
    costs = parse_unit_cost_table(frame, {"Alpha", "Beta", "Gamma"})
    assert costs == {"Alpha": 1.5, "Beta": 0.0}
    assert resolve_unit_cost("Gamma", costs) is None
    assert resolve_unit_cost("Alpha", costs) == 1.5


def test_parse_accepts_sku_name_column() -> None:
    frame = pd.DataFrame({"SKU Name": ["Alpha"], "Unit Cost": [2.25]})
    assert parse_unit_cost_table(frame, {"Alpha"}) == {"Alpha": 2.25}


def test_parse_rejects_unknown_negative_and_blank() -> None:
    with pytest.raises(UnitCostImportError, match="unknown SKU"):
        parse_unit_cost_table(pd.DataFrame({"SKU": ["Nope"], "cost": [1]}), {"Alpha"})
    with pytest.raises(UnitCostImportError, match="negative"):
        parse_unit_cost_table(pd.DataFrame({"SKU": ["Alpha"], "unit_cost": [-1]}), {"Alpha"})
    with pytest.raises(UnitCostImportError, match="blank"):
        parse_unit_cost_table(pd.DataFrame({"SKU": ["Alpha"], "Unit Cost": [None]}), {"Alpha"})
    with pytest.raises(UnitCostImportError, match="not finite"):
        parse_unit_cost_table(pd.DataFrame({"SKU": ["Alpha"], "Unit Cost": ["inf"]}), {"Alpha"})


def test_design_sheet_stores_unit_costs() -> None:
    doc = import_design_sheet(
        _workbook(
            {
                "Product List": _products(),
                "Unit Costs": pd.DataFrame({"SKU": ["Alpha"], "Unit Cost": [2.5]}),
            }
        )
    )
    by_name = {p.name: p.unit_cost for p in doc.products}
    assert by_name["Alpha"] == 2.5
    assert by_name["Beta"] is None
    assert doc.meta.unit_cost_source == "design"
    assert doc.meta.unit_cost_sku_count == 1


def test_design_without_cost_sheet_leaves_costs_empty() -> None:
    doc = import_design_sheet(_workbook({"Product List": _products()}))
    assert doc.meta.unit_cost_source == ""
    assert all(p.unit_cost is None for p in doc.products)


def test_bad_cost_sheet_fails_design_parse() -> None:
    with pytest.raises(ExcelImportError, match="Unit Costs sheet"):
        import_design_sheet(
            _workbook(
                {
                    "Product List": _products(),
                    "Unit Costs": pd.DataFrame({"SKU": ["Alpha"], "Unit Cost": [-3]}),
                }
            )
        )

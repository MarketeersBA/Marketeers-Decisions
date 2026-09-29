"""Tests for product-list Group* column fallback in excel_importer."""

from __future__ import annotations

import pandas as pd

from data.excel_importer import _group_type_from_column, _groups_from_product_list_df
from model.study_schema import ProductDef


def _product(name: str, pid: int) -> ProductDef:
    return ProductDef(product_id=pid, name=name, company="Company")


def test_group_type_from_column() -> None:
    assert _group_type_from_column("Group Brand") == "Brand"
    assert _group_type_from_column("group inches") == "Inches"
    assert _group_type_from_column("GROUP Size") == "Size"
    assert _group_type_from_column("Base Price") is None
    assert _group_type_from_column("Group Name") == "Name"


def test_groups_from_product_list_columns() -> None:
    df = pd.DataFrame(
        {
            "SKU Name": ["SKU A", "SKU B", "SKU C", "SKU D"],
            "Group Brand": ["TOSHIBA", "TOSHIBA", "SAMSUNG", "SAMSUNG"],
            "Group Inches": ["32", "43", "32", "55"],
            "Base Price": [100, 200, 150, 250],
        }
    )
    products = [_product("SKU A", 1), _product("SKU B", 2), _product("SKU C", 3), _product("SKU D", 4)]

    groups = _groups_from_product_list_df(df, products)

    by_key = {(g.group_type, g.group_name): g.product_names for g in groups}
    assert by_key[("Brand", "TOSHIBA")] == ["SKU A", "SKU B"]
    assert by_key[("Brand", "SAMSUNG")] == ["SKU C", "SKU D"]
    assert by_key[("Inches", "32")] == ["SKU A", "SKU C"]
    assert by_key[("Inches", "43")] == ["SKU B"]
    assert by_key[("Inches", "55")] == ["SKU D"]


def test_groups_from_product_list_skips_blank_values() -> None:
    df = pd.DataFrame(
        {
            "SKU Name": ["SKU A", "SKU B"],
            "Group Brand": ["TOSHIBA", None],
        }
    )
    products = [_product("SKU A", 1), _product("SKU B", 2)]

    groups = _groups_from_product_list_df(df, products)

    assert len(groups) == 1
    assert groups[0].group_type == "Brand"
    assert groups[0].group_name == "TOSHIBA"
    assert groups[0].product_names == ["SKU A"]

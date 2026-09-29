"""HBU column mapping and multi-conditional level rows."""

from __future__ import annotations

import pandas as pd

from data.excel_importer import _build_hbu_column_map
from model.attribute_utilities import AttributeUtilityModel, _conditional_levels_by_product
from model.study_schema import (
    AttributeDef,
    ConditionalLevelRow,
    ProductDef,
    StudyDocument,
    StudyMeta,
)


def _oil_like_doc() -> StudyDocument:
    products = [
        ProductDef(1, "Afia Corn 1.5L", base_attributes={"Price": 21.88, "Size": 1.5}),
        ProductDef(2, "Afia Corn 2.9L", base_attributes={"Price": 37.7, "Size": 2.9}),
    ]
    attrs = [
        AttributeDef("SKU", "Discrete", level_count=2, is_sku=True),
        AttributeDef("Price", "Conditional", level_count=3),
        AttributeDef("Size", "Conditional", level_count=2, is_size=True),
    ]
    cond = [
        ConditionalLevelRow(1, "Afia Corn 1.5L", {"Level 1": 10.0, "Level 2": 20.0, "Level 3": 30.0}, "Price"),
        ConditionalLevelRow(2, "Afia Corn 2.9L", {"Level 1": 20.0, "Level 2": 40.0, "Level 3": 60.0}, "Price"),
        ConditionalLevelRow(1, "Afia Corn 1.5L", {"Level 1": 1.0, "Level 2": 1.5}, "Size"),
        ConditionalLevelRow(2, "Afia Corn 2.9L", {"Level 1": 2.0, "Level 2": 2.9}, "Size"),
    ]
    return StudyDocument(
        meta=StudyMeta(study_name="Oil Map Test", products_count=2),
        attributes=attrs,
        products=products,
        conditional_levels=cond,
    )


def test_hbu_positional_map_arabic_headers() -> None:
    from data.excel_importer import _unique_headers

    doc = _oil_like_doc()
    headers = _unique_headers(
        [
            "Respondent",
            "RLH",
            "عافية ذرة",
            "عافية ذرة.1",
            "-0.6",
            "0",
            "0.6",
            "-0.35",
            "0.1",
            "0.1",
            "NONE",
        ]
    )
    mapping = _build_hbu_column_map(headers, doc)
    assert mapping["عافية ذرة"] == "ProductID1"
    assert mapping["عافية ذرة.1"] == "ProductID2"
    assert mapping["-0.6"] == "PriceLevel1"
    assert mapping["0"] == "PriceLevel2"
    assert mapping["0.6"] == "PriceLevel3"
    assert mapping["-0.35"] == "SizeLevel1"
    assert mapping["0.1"] == "SizeLevel2"
    assert "NONE" not in mapping


def test_unique_headers_preserve_duplicate_level_labels() -> None:
    from data.excel_importer import _unique_headers

    assert _unique_headers(["0.1", "0.1", "0.2"]) == ["0.1", "0.1__dup1", "0.2"]


def test_conditional_levels_do_not_overwrite_price_with_size() -> None:
    doc = _oil_like_doc()
    price = next(a for a in doc.attributes if a.name == "Price")
    size = next(a for a in doc.attributes if a.name == "Size")
    assert _conditional_levels_by_product(doc, price)[1]["Level 1"] == 10.0
    assert _conditional_levels_by_product(doc, size)[1]["Level 1"] == 1.0

    hbu = pd.DataFrame(
        {
            "RespondentID": [1],
            "RespondentWeight": [1.0],
            "ProductID1": [1.0],
            "ProductID2": [2.0],
            "PriceLevel1": [3.0],
            "PriceLevel2": [2.0],
            "PriceLevel3": [1.0],
            "SizeLevel1": [0.5],
            "SizeLevel2": [0.0],
        }
    )
    util = AttributeUtilityModel(doc, hbu, [1, 2])
    price_idx = next(i for i, a in enumerate(util.attributes) if a.name == "Price")
    size_idx = next(i for i, a in enumerate(util.attributes) if a.name == "Size")
    assert list(util._conditional_grid[price_idx][0, :3]) == [10.0, 20.0, 30.0]
    assert list(util._conditional_grid[size_idx][0, :2]) == [1.0, 1.5]


def test_legacy_untagged_conditional_rows_match_by_level_count() -> None:
    doc = _oil_like_doc()
    for row in doc.conditional_levels:
        row.attribute_name = ""
    price = next(a for a in doc.attributes if a.name == "Price")
    size = next(a for a in doc.attributes if a.name == "Size")
    assert len(_conditional_levels_by_product(doc, price)[1]) == 3
    assert len(_conditional_levels_by_product(doc, size)[1]) == 2

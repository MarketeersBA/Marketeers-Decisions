"""Design-import soft warnings for missing Price Attribute Levels."""

from __future__ import annotations

from data.excel_importer import collect_design_import_warnings
from model.study_schema import (
    AttributeDef,
    ConditionalLevelRow,
    ProductDef,
    StudyDocument,
    StudyMeta,
)


def _base_doc(**kwargs) -> StudyDocument:
    return StudyDocument(
        meta=StudyMeta(study_name="Warn Test", products_count=2),
        attributes=[
            AttributeDef("SKU", "Discrete", level_count=2, is_sku=True),
            AttributeDef("Price", "Conditional", level_count=3),
            AttributeDef("Size", "Conditional", level_count=2, is_size=True),
        ],
        products=[
            ProductDef(1, "SKU A", base_attributes={"Price": 25.0}),
            ProductDef(2, "SKU B", base_attributes={"Price": 40.0}),
        ],
        **kwargs,
    )


def test_no_warning_when_price_levels_present() -> None:
    doc = _base_doc(
        conditional_levels=[
            ConditionalLevelRow(
                1, "SKU A", {"Level 1": 10.0, "Level 2": 25.0, "Level 3": 45.0}, "Price"
            ),
            ConditionalLevelRow(
                2, "SKU B", {"Level 1": 20.0, "Level 2": 40.0, "Level 3": 60.0}, "Price"
            ),
            ConditionalLevelRow(1, "SKU A", {"Level 1": 1.0, "Level 2": 1.5}, "Size"),
        ]
    )
    assert collect_design_import_warnings(doc) == []


def test_warning_when_only_size_levels_exist() -> None:
    doc = _base_doc(
        conditional_levels=[
            ConditionalLevelRow(1, "SKU A", {"Level 1": 1.0, "Level 2": 1.5}, "Size"),
            ConditionalLevelRow(2, "SKU B", {"Level 1": 2.0, "Level 2": 2.9}, "Size"),
        ]
    )
    warnings = collect_design_import_warnings(doc)
    assert len(warnings) == 1
    assert "No Price Attribute Levels" in warnings[0]
    assert "±40%" in warnings[0]


def test_warning_lists_partial_missing_products() -> None:
    doc = _base_doc(
        conditional_levels=[
            ConditionalLevelRow(
                1, "SKU A", {"Level 1": 10.0, "Level 2": 25.0, "Level 3": 45.0}, "Price"
            ),
        ]
    )
    warnings = collect_design_import_warnings(doc)
    assert len(warnings) == 1
    assert "SKU B" in warnings[0]
    assert "±40%" in warnings[0]

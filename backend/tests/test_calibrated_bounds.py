"""Price calibrated bounds use Price Attribute Levels only."""

from __future__ import annotations

import warnings

import pytest

from model.optimizer import get_calibrated_bounds
from model.study_schema import (
    AttributeDef,
    ConditionalLevelRow,
    ProductDef,
    StudyDocument,
    StudyMeta,
)


def _doc_with_price_and_size() -> StudyDocument:
    return StudyDocument(
        meta=StudyMeta(study_name="Bounds Test", products_count=1),
        attributes=[
            AttributeDef("SKU", "Discrete", level_count=1, is_sku=True),
            AttributeDef("Price", "Conditional", level_count=3),
            AttributeDef("Size", "Conditional", level_count=2, is_size=True),
        ],
        products=[
            ProductDef(1, "SKU A", base_attributes={"Price": 25.0, "Size": 1.5}),
        ],
        conditional_levels=[
            ConditionalLevelRow(
                1, "SKU A", {"Level 1": 10.0, "Level 2": 25.0, "Level 3": 45.0}, "Price"
            ),
            ConditionalLevelRow(
                1, "SKU A", {"Level 1": 1.0, "Level 2": 1.5}, "Size"
            ),
        ],
    )


def test_bounds_from_price_attribute_levels() -> None:
    doc = _doc_with_price_and_size()
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        lo, hi = get_calibrated_bounds(doc, 1, 25.0)
    assert (lo, hi) == (10.0, 45.0)
    assert caught == []


def test_size_levels_are_not_used_as_price_bounds() -> None:
    doc = _doc_with_price_and_size()
    doc.conditional_levels = [
        ConditionalLevelRow(1, "SKU A", {"Level 1": 1.0, "Level 2": 1.5}, "Size"),
        ConditionalLevelRow(1, "SKU A", {"Level 1": 1.0, "Level 2": 1.5}, ""),
    ]
    with pytest.warns(UserWarning, match="No Price Attribute Levels"):
        lo, hi = get_calibrated_bounds(doc, 1, 25.0)
    assert lo == pytest.approx(15.0)
    assert hi == pytest.approx(35.0)


def test_missing_price_levels_falls_back_to_plus_minus_40() -> None:
    doc = StudyDocument(
        meta=StudyMeta(study_name="No Price Levels", products_count=1),
        attributes=[AttributeDef("Price", "Conditional", level_count=3)],
        products=[ProductDef(1, "SKU A", base_attributes={"Price": 20.0})],
        conditional_levels=[],
    )
    with pytest.warns(UserWarning, match="±40%"):
        lo, hi = get_calibrated_bounds(doc, 1, 20.0)
    assert (lo, hi) == (12.0, 28.0)

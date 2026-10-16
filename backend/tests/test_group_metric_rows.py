"""Unit tests for group_metric_rows Tier 1 fields."""

from __future__ import annotations

from model.groups import group_metric_rows
from model.study_model import ProductState, StudyModel
from model.study_schema import GroupDef, StudyDocument, StudyMeta


def _product(
    name: str,
    *,
    included: bool = True,
    n: float = 10.0,
    b: float = 8.0,
    base_revenue: float = 100.0,
    revenue: float = 120.0,
) -> ProductState:
    return ProductState(
        product_id=1,
        name=name,
        company="Co",
        included=included,
        base_share=b,
        base_wd=100.0,
        new_wd=100.0,
        new_share=n,
        base_revenue=base_revenue,
        revenue=revenue,
        nos=10.0,
        tdc=5.0,
        audit_share=7.0,
        new_preference_share=9.0,
        penetration=1.0,
        value_share=11.0,
    )


def test_group_metric_rows_product_names_and_indices() -> None:
    doc = StudyDocument(
        meta=StudyMeta(financial=True),
        groups=[GroupDef(group_type="Brand", group_name="Alpha", product_names=["A", "B", "Missing"])],
    )
    model = StudyModel.__new__(StudyModel)
    model.doc = doc
    model.financial = True
    model.products = [_product("A"), _product("B", n=5.0, b=4.0)]
    model.get_product = lambda name: next((p for p in model.products if p.name == name), None)  # type: ignore[method-assign]

    rows = group_metric_rows(model, "Brand")
    assert len(rows) == 1
    row = rows[0]
    assert row["productNames"] == ["A", "B"]
    assert row["N.Share"] == 15.0
    assert row["B.Share"] == 12.0
    assert row["S.Index"] == 15.0 / 12.0
    assert row["Revenue"] == 240.0
    assert row["R.Index"] == 240.0 / 200.0
    assert row["MM$"] == (120 - 10 - 5) * 2


def test_group_metric_rows_sorted_by_base_share_desc() -> None:
    doc = StudyDocument(
        meta=StudyMeta(financial=False),
        groups=[
            GroupDef(group_type="Brand", group_name="Small", product_names=["S"]),
            GroupDef(group_type="Brand", group_name="Large", product_names=["L"]),
            GroupDef(group_type="Brand", group_name="Mid", product_names=["M"]),
        ],
    )
    model = StudyModel.__new__(StudyModel)
    model.doc = doc
    model.financial = False
    model.products = [
        _product("S", n=1.0, b=2.0),
        _product("L", n=20.0, b=30.0),
        _product("M", n=5.0, b=10.0),
    ]
    model.get_product = lambda name: next((p for p in model.products if p.name == name), None)  # type: ignore[method-assign]

    names = [r["Name"] for r in group_metric_rows(model, "Brand")]
    assert names == ["Large", "Mid", "Small"]


def test_group_metric_rows_omits_mm_when_not_financial() -> None:
    doc = StudyDocument(
        meta=StudyMeta(financial=False),
        groups=[GroupDef(group_type="Brand", group_name="Alpha", product_names=["A"])],
    )
    model = StudyModel.__new__(StudyModel)
    model.doc = doc
    model.financial = False
    model.products = [_product("A")]
    model.get_product = lambda name: next((p for p in model.products if p.name == name), None)  # type: ignore[method-assign]

    row = group_metric_rows(model, "Brand")[0]
    assert "MM$" not in row
    assert row["productNames"] == ["A"]


def test_group_r_index_keeps_excluded_sku_in_base_denominator() -> None:
    """Excluding a weak SKU must not inflate brand R.Index (legacy BaseIncluded denom)."""
    weak = _product(
        "dala 1.5",
        included=False,
        n=0.0,
        b=6.0,
        base_revenue=100.0,
        revenue=0.0,
    )
    strong = _product(
        "dala other",
        included=True,
        n=4.0,
        b=6.0,
        base_revenue=100.0,
        revenue=150.0,
    )
    doc = StudyDocument(
        meta=StudyMeta(financial=False),
        groups=[GroupDef(group_type="Brand", group_name="Dalal", product_names=["dala 1.5", "dala other"])],
    )
    model = StudyModel.__new__(StudyModel)
    model.doc = doc
    model.financial = False
    model.products = [weak, strong]
    model._base_snapshot = [
        _product("dala 1.5", included=True, b=6.0, base_revenue=100.0),
        _product("dala other", included=True, b=6.0, base_revenue=100.0),
    ]
    model.get_product = lambda name: next((p for p in model.products if p.name == name), None)  # type: ignore[method-assign]

    row = group_metric_rows(model, "Brand")[0]
    assert row["Revenue"] == 150.0
    assert row["B.Share"] == 12.0
    assert row["N.Share"] == 4.0
    # Denominator keeps both base revenues (200), not only the remaining SKU (100).
    assert row["R.Index"] == 150.0 / 200.0
    # Wrong (old) behavior would have been 150/100 = 1.5.
    assert row["R.Index"] < 1.0

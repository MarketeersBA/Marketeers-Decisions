"""Tests for Standalone / Offer Type SKU filtering."""

from __future__ import annotations

from model.offer_type_filter import filter_standalone_offer_skus
from model.study_schema import GroupDef, StudyDocument, StudyMeta


def test_filter_passes_through_without_offer_type_groups() -> None:
    doc = StudyDocument(
        meta=StudyMeta(),
        groups=[GroupDef(group_type="Brand", group_name="A", product_names=["SKU A", "Bundle 1"])],
    )
    assert filter_standalone_offer_skus(doc, ["SKU A", "Bundle 1"]) == ["SKU A", "Bundle 1"]


def test_filter_keeps_only_standalone_when_offer_type_present() -> None:
    doc = StudyDocument(
        meta=StudyMeta(),
        groups=[
            GroupDef(group_type="Brand", group_name="A", product_names=["SKU A", "SKU B", "Combo"]),
            GroupDef(group_type="Offer Type", group_name="Standalone", product_names=["SKU A", "SKU B"]),
            GroupDef(group_type="Offer Type", group_name="Bundle", product_names=["Combo"]),
        ],
    )
    assert filter_standalone_offer_skus(doc, ["SKU A", "SKU B", "Combo"]) == ["SKU A", "SKU B"]

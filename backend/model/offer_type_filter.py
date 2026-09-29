"""Offer Type group filtering — keep Standalone SKUs when that group type exists."""

from __future__ import annotations

from model.optimizer import get_all_group_types, get_groups_by_type
from model.study_schema import StudyDocument

_OFFER_TYPE_GROUP = "Offer Type"
_STANDALONE_OFFER = "Standalone"


def _offer_type_group_type(doc: StudyDocument) -> str | None:
    for gt in get_all_group_types(doc):
        if gt.strip().casefold() == _OFFER_TYPE_GROUP.casefold():
            return gt
    return None


def standalone_offer_sku_set(doc: StudyDocument) -> set[str] | None:
    """Allowed Standalone SKUs, or None when Offer Type groups are absent."""
    gt = _offer_type_group_type(doc)
    if gt is None:
        return None
    groups = get_groups_by_type(doc, gt)
    for name, skus in groups.items():
        if name.strip().casefold() == _STANDALONE_OFFER.casefold():
            return set(skus)
    return set()


def filter_standalone_offer_skus(doc: StudyDocument, skus: list[str]) -> list[str]:
    """When Offer Type groups exist, keep only Standalone SKUs; otherwise pass through."""
    allowed = standalone_offer_sku_set(doc)
    if allowed is None:
        return list(skus)
    return [s for s in skus if s in allowed]

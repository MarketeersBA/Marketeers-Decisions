"""Typed schema for folder-per-study storage (study.json)."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class StudyMeta:
    study_name: str = ""
    study_description: str = ""
    company_name: str = ""
    company_location: str = ""
    category: str = ""
    msu: float = 1.0
    su: float = 1.0
    vsu: float = 0.0
    exponent_factor: float = 1.0
    respondents_count: int = 0
    products_count: int = 0
    use_grouping: bool = False
    use_segmenting: bool = False
    financial: bool = False
    sku_attribute: str = "SKU"
    size_attribute: str = "Size"
    price_currency_symbol: str = "€"
    size_unit_label: str = "L"
    design_source_filename: str = ""
    hbu_source_filename: str = ""
    design_source_updated_at: str = ""
    hbu_source_updated_at: str = ""
    ingested_at: str = ""
    data_period: str = ""
    data_source: str = ""


@dataclass
class AttributeDef:
    name: str
    attr_type: str  # Discrete | Conditional
    level_count: int = 0
    is_sku: bool = False
    is_size: bool = False
    included: bool = True
    visible: bool = True
    level_names: list[str] = field(default_factory=list)


@dataclass
class ProductDef:
    product_id: int
    name: str
    company: str = ""
    included: bool = True
    base_market_share: float = 0.0
    audit_share: float | None = None
    base_wd: float = 1.0
    base_product_id: int = 0
    base_attributes: dict[str, Any] = field(default_factory=dict)
    is_new_product: bool = False
    is_replaced_product: bool = False


@dataclass
class ConditionalLevelRow:
    product_id: int
    product_name: str
    levels: dict[str, float] = field(default_factory=dict)
    attribute_name: str = ""


@dataclass
class SegmentDef:
    segment_type: str
    segment_name: str
    share: float = 0.0
    wd: float = 0.0


@dataclass
class GroupDef:
    group_type: str
    group_name: str
    product_names: list[str] = field(default_factory=list)


@dataclass
class RespondentSegmentation:
    respondent_id: int
    assignments: dict[str, str] = field(default_factory=dict)


@dataclass
class StudyDocument:
    version: int = 1
    meta: StudyMeta = field(default_factory=StudyMeta)
    attributes: list[AttributeDef] = field(default_factory=list)
    products: list[ProductDef] = field(default_factory=list)
    conditional_levels: list[ConditionalLevelRow] = field(default_factory=list)
    segments: list[SegmentDef] = field(default_factory=list)
    segment_shares_wd: list[dict[str, Any]] = field(default_factory=list)
    groups: list[GroupDef] = field(default_factory=list)
    respondent_segmentation: list[RespondentSegmentation] = field(default_factory=list)
    excluded_sales_units: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> StudyDocument:
        meta = StudyMeta(**data.get("meta", {}))
        attrs = [AttributeDef(**a) for a in data.get("attributes", [])]
        products = []
        for p in data.get("products", []):
            products.append(ProductDef(**p))
        cond = [ConditionalLevelRow(**c) for c in data.get("conditional_levels", [])]
        segs = [SegmentDef(**s) for s in data.get("segments", [])]
        groups = [GroupDef(**g) for g in data.get("groups", [])]
        resp_seg = [RespondentSegmentation(**r) for r in data.get("respondent_segmentation", [])]
        return cls(
            version=data.get("version", 1),
            meta=meta,
            attributes=attrs,
            products=products,
            conditional_levels=cond,
            segments=segs,
            segment_shares_wd=data.get("segment_shares_wd", []),
            groups=groups,
            respondent_segmentation=resp_seg,
            excluded_sales_units=data.get("excluded_sales_units", []),
        )

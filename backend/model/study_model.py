"""In-memory study state for simulation."""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from model.attribute_utilities import AttributeUtilityModel
from model.segmentation import segmentation_dimensions, segment_members
from model.study_schema import AttributeDef, ProductDef, StudyDocument


@dataclass
class ProductState:
    product_id: int
    name: str
    company: str
    included: bool
    base_share: float
    base_wd: float
    new_wd: float
    base_attributes: dict[str, Any] = field(default_factory=dict)
    new_attributes: dict[str, Any] = field(default_factory=dict)
    discrete_levels: dict[str, int] = field(default_factory=dict)
    base_product_id: int = 0
    product_type: str = "ExistingProduct"
    promotion_calibration: float = 1.0
    consumption_calibration: float = 1.0
    sor: float = 1.0
    awareness_level: float = 1.0
    repeat_rate: float = 1.0
    size_unit: float = 1.0
    nos: float = 0.0
    tdc: float = 0.0
    new_nos: float | None = None
    new_tdc: float | None = None
    audit_share: float = 0.0
    # Runtime simulation fields (ports Products.cs)
    current_share: float = 0.0
    new_share: float = 0.0
    diff_volume_share: float = 0.0
    base_preference_share: float = 0.0
    current_preference_share: float = 0.0
    new_preference_share: float = 0.0
    penetration: float = 0.0
    revenue: float = 0.0
    base_revenue: float = 0.0
    value_sales_unit: float = 0.0
    base_value_sales_unit: float = 0.0
    value_share: float = 0.0
    base_value_share: float = 0.0

    def get_attribute(self, attr_index: int, *, use_new: bool) -> float:
        if attr_index < 0:
            return 1.0
        return 0.0  # overridden via StudyModel


class StudyModel:
    """Mutable runtime study used by share_engine."""

    def __init__(self, doc: StudyDocument, hbu: pd.DataFrame) -> None:
        self.doc = doc
        self.hbu = hbu.copy()
        self.exponent = float(doc.meta.exponent_factor or 1.0)
        self.financial = doc.meta.financial
        self.use_grouping = doc.meta.use_grouping
        self.msu = float(doc.meta.msu or 1.0)
        self.su = float(doc.meta.su or 1.0)
        self.vsu = float(getattr(doc.meta, "vsu", 0.0) or 0.0)
        self.attributes: list[AttributeDef] = list(doc.attributes)
        self.conditional_attrs = [a.name for a in doc.attributes if a.attr_type == "Conditional"]
        self.discrete_attrs = [a.name for a in doc.attributes if a.attr_type == "Discrete"]
        self.price_attribute_index = self._attr_index("Price")
        self.size_attribute_index = self._attr_index(doc.meta.size_attribute or "Size")
        self.n_respondents = len(hbu)
        self.respondent_selection = np.ones(self.n_respondents, dtype=bool)
        self.products = self._init_products()
        product_ids = [p.product_id for p in self.products]
        self.utilities = AttributeUtilityModel(doc, hbu, product_ids)
        self.active_segments: list[tuple[str, str]] = []
        self._bind_get_attribute()
        self._apply_segmentation_filter()
        self._base_snapshot = self._snapshot()

    def _attr_index(self, name: str) -> int:
        nl = name.lower()
        for i, a in enumerate(self.attributes):
            if a.name.lower() == nl:
                return i
        return -1

    def _discrete_level_index(self, attr_name: str, value: Any) -> int:
        attr = next((a for a in self.doc.attributes if a.name == attr_name), None)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return int(value)
        s = str(value).strip()
        if attr and attr.level_names:
            try:
                return attr.level_names.index(s) + 1
            except ValueError:
                pass
        try:
            return int(float(s))
        except ValueError:
            return 1

    def _product_type(self, p: ProductDef) -> str:
        if p.is_replaced_product or (p.base_market_share == 0 and p.base_product_id > 0):
            return "ReplacedProduct"
        if p.is_new_product or (p.base_market_share == 0 and p.base_product_id == 0 and not p.included):
            return "NewProduct"
        return "ExistingProduct"

    def _init_products(self) -> list[ProductState]:
        states: list[ProductState] = []
        for p in self.doc.products:
            new_attrs: dict[str, Any] = {}
            discrete: dict[str, int] = {}
            for k, v in p.base_attributes.items():
                attr = next((a for a in self.doc.attributes if a.name == k), None)
                if attr and attr.attr_type == "Discrete" and not attr.is_sku:
                    discrete[k] = self._discrete_level_index(k, v)
                elif attr and attr.attr_type == "Conditional":
                    try:
                        new_attrs[k] = float(v)
                    except (TypeError, ValueError):
                        new_attrs[k] = v
                else:
                    new_attrs[k] = v
            size_val = float(p.base_attributes.get(self.doc.meta.size_attribute, 1.0) or 1.0)
            states.append(
                ProductState(
                    product_id=p.product_id,
                    name=p.name,
                    company=p.company,
                    included=p.included,
                    base_share=p.base_market_share,
                    audit_share=p.audit_share if p.audit_share is not None else p.base_market_share,
                    base_wd=p.base_wd,
                    new_wd=p.base_wd,
                    base_attributes=dict(p.base_attributes),
                    new_attributes=new_attrs,
                    discrete_levels=discrete,
                    base_product_id=p.base_product_id,
                    product_type=self._product_type(p),
                    size_unit=size_val,
                    current_share=p.base_market_share,
                )
            )
        return states

    def product_by_id(self, product_id: int) -> ProductState | None:
        return next((p for p in self.products if p.product_id == product_id), None)

    def product_attribute_values(self, product: ProductState, *, use_new: bool) -> list[float]:
        values: list[float] = []
        for a_idx, attr in enumerate(self.attributes):
            if attr.is_sku or attr.name.upper() == "SKU":
                values.append(float(product.product_id))
            elif attr.attr_type == "Discrete":
                if use_new:
                    values.append(float(product.discrete_levels.get(attr.name, 1)))
                else:
                    base = product.base_attributes.get(attr.name, 1)
                    values.append(float(self._discrete_level_index(attr.name, base)))
            elif attr.attr_type == "Conditional":
                if use_new:
                    raw = product.new_attributes.get(
                        attr.name, product.base_attributes.get(attr.name, 0)
                    )
                else:
                    raw = product.base_attributes.get(attr.name, 0)
                try:
                    values.append(float(raw))
                except (TypeError, ValueError):
                    values.append(0.0)
            else:
                values.append(0.0)
        return values

    def _bind_get_attribute(self) -> None:
        def make_getter(model: StudyModel, prod: ProductState):
            def get_attribute(attr_index: int, *, use_new: bool) -> float:
                vals = model.product_attribute_values(prod, use_new=use_new)
                if attr_index < 0 or attr_index >= len(vals):
                    return 1.0
                return vals[attr_index]

            return get_attribute

        for p in self.products:
            p.get_attribute = make_getter(self, p)  # type: ignore[method-assign]

    def _snapshot(self) -> list[ProductState]:
        return copy.deepcopy(self.products)

    def reset(self) -> None:
        self.products = copy.deepcopy(self._base_snapshot)
        self.respondent_selection = np.ones(self.n_respondents, dtype=bool)
        self.active_segments = []
        self._bind_get_attribute()
        self._apply_segmentation_filter()

    def get_product(self, name: str) -> ProductState | None:
        return next((p for p in self.products if p.name == name), None)

    def included_products(self) -> list[ProductState]:
        return [p for p in self.products if p.included]

    def base_inclusion(self) -> list[bool]:
        """Original product inclusion flags from study load (before scenario edits)."""
        return [snap.included for snap in self._base_snapshot]

    def respondent_weights_raw(self) -> np.ndarray:
        if "RespondentWeight" in self.hbu.columns:
            return self.hbu["RespondentWeight"].to_numpy(dtype=float)
        return np.ones(self.n_respondents, dtype=float)

    def respondent_weights(self) -> np.ndarray:
        w = self.respondent_weights_raw()
        total = w.sum()
        return w / total if total else np.ones(len(w)) / max(len(w), 1)

    def product_utility_columns(self) -> list[str]:
        return [c for c in self.hbu.columns if c.startswith("ProductID")]

    def set_segmentation_filters(self, filters: list[tuple[str, str]]) -> None:
        self.active_segments = [(k, m) for k, m in filters if k and m]
        self._apply_segmentation_filter()

    def set_segmentation(self, segment_type: str, segment_member: str) -> None:
        if segment_type and segment_member:
            self.set_segmentation_filters([(segment_type, segment_member)])
        else:
            self.set_segmentation_filters([])

    def clear_segmentation(self) -> None:
        self.active_segments = []
        self.respondent_selection = np.ones(self.n_respondents, dtype=bool)

    def segmentation_dimension_options(self) -> list[tuple[str, str]]:
        """(display label, assignment column key)."""
        return segmentation_dimensions(self.doc)

    def members_for_segment(self, assignment_key: str) -> list[str]:
        return segment_members(self.doc, assignment_key)

    def active_segmentation_labels(self) -> list[str]:
        if not self.active_segments:
            return []
        dim_map = {k: lbl for lbl, k in self.segmentation_dimension_options()}
        out: list[str] = []
        for key, member in self.active_segments:
            label = dim_map.get(key, key)
            out.append(f"{label} → {member}")
        return out

    def active_segmentation_label(self) -> str | None:
        labels = self.active_segmentation_labels()
        if not labels:
            return None
        return " · ".join(labels)

    @property
    def filtered_respondent_count(self) -> int:
        return int(self.respondent_selection.sum())

    def _apply_segmentation_filter(self) -> None:
        if not self.active_segments or not self.doc.respondent_segmentation:
            self.respondent_selection = np.ones(self.n_respondents, dtype=bool)
            return
        self.respondent_selection = np.ones(self.n_respondents, dtype=bool)
        for seg_type, seg_member in self.active_segments:
            mask = np.zeros(self.n_respondents, dtype=bool)
            for i, rs in enumerate(self.doc.respondent_segmentation):
                if i >= self.n_respondents:
                    break
                assigned = rs.assignments.get(seg_type, "")
                if str(assigned) == str(seg_member):
                    mask[i] = True
            self.respondent_selection &= mask

    @property
    def study_name(self) -> str:
        return self.doc.meta.study_name

    @property
    def company_name(self) -> str:
        return self.doc.meta.company_name

    @property
    def category(self) -> str:
        return getattr(self.doc.meta, "category", "") or ""

    @property
    def market(self) -> str:
        return self.doc.meta.company_location or ""

    @property
    def base(self) -> str:
        return self.doc.meta.study_description or ""

    @property
    def segment_types(self) -> list[str]:
        return [label for label, _ in self.segmentation_dimension_options()]

    @property
    def group_types(self) -> list[str]:
        return list({g.group_type for g in self.doc.groups})

    @property
    def all_product_names(self) -> list[str]:
        return [p.name for p in self.products]

    @property
    def company_products(self) -> list[str]:
        return [p.name for p in self.products if p.company]

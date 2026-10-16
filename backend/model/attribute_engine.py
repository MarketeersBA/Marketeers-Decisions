"""Attribute change logic (ports changeProductAttributeCombination)."""

from __future__ import annotations

from model.study_model import ProductState, StudyModel


class AttributeEngine:
    def change(self, model: StudyModel, product_name: str, attribute: str, value: str) -> None:
        product = model.get_product(product_name)
        if product is None:
            return
        clean = value.strip()
        attr = attribute.replace("New ", "").strip()

        if attr.upper() == "WD":
            product.new_wd = float(clean.replace("%", ""))
            if product.new_wd == 0.0:
                # Legacy changeProductAttributeCombination: WD=0 excludes and clears shares.
                product.included = False
                product.new_share = 0.0
                product.new_preference_share = 0.0
            return

        if attr in model.discrete_attrs:
            product.discrete_levels[attr] = model._discrete_level_index(attr, clean)
            return

        if clean.endswith("%") or (len(clean) > 0 and clean.replace(".", "").replace("-", "").isdigit() is False and "%" in value):
            base_key = attr.replace("%", "")
            base = float(product.new_attributes.get(base_key, product.base_attributes.get(base_key, 0)))
            pct = float(clean.replace("%", "")) / 100.0
            product.new_attributes[base_key] = base * (1 + pct)
        else:
            try:
                product.new_attributes[attr] = float(clean)
            except ValueError:
                product.new_attributes[attr] = clean

    def include_exclude(self, model: StudyModel, product_name: str, include: bool) -> None:
        """Include/exclude a product (ports ProjectCore.includeExcludeProductScenarios).

        On exclude, clear scenario share fields so naive all-product aggregates
        (totals, rebase, FastEvaluator scope volume) do not keep stale values.
        """
        product = model.get_product(product_name)
        if product is None:
            return
        product.included = include
        if not include:
            product.new_share = 0.0
            product.new_preference_share = 0.0

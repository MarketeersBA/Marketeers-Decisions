"""Elasticity grids — ported from conditionalAttributeElasticityPer*."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from model.analytics._helpers import levels_for_attribute

if TYPE_CHECKING:
    from model.project_core import ProjectCore
    from model.study_model import ProductState, StudyModel

ElasticityMode = Literal["sku", "group", "company_sku", "company_group"]


def _group_members(model: "StudyModel", group_type: str) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for g in model.doc.groups:
        if g.group_type != group_type:
            continue
        if g.group_name not in seen:
            seen.add(g.group_name)
            names.append(g.group_name)
    return names


def _products_in_member(
    model: "StudyModel", group_type: str, member: str
) -> list["ProductState"]:
    out: list[ProductState] = []
    for g in model.doc.groups:
        if g.group_type != group_type or g.group_name != member:
            continue
        for name in g.product_names:
            p = model.get_product(name)
            if p and p.included:
                out.append(p)
    return out


def _restore_defaults(
    project: "ProjectCore",
    products: list["ProductState"],
    attribute_name: str,
    defaults: dict[str, object],
) -> None:
    for p in products:
        if p.name in defaults and defaults[p.name] is not None:
            project.change_product_attribute(p.name, attribute_name, str(defaults[p.name]))


def _rel_change(after: float, base: float) -> float:
    if base == 0.0:
        return 0.0
    return (after - base) / base


def conditional_attribute_elasticity_per_product(
    project: "ProjectCore",
    attribute_name: str = "Price",
    product_name: str | None = None,
) -> list[dict]:
    model = project._model
    if model is None:
        return []
    project.find_predicted_shares()
    base_shares = {p.product_id: p.new_share for p in model.included_products()}
    rows: list[dict] = []

    products = list(model.included_products())
    if product_name:
        products = [p for p in products if p.name == product_name]

    for product in products:
        levels = levels_for_attribute(model, product.name, attribute_name)
        if not levels:
            continue
        default = product.new_attributes.get(attribute_name, product.base_attributes.get(attribute_name))
        level_values: dict[str, float] = {}
        for level_name, level_val in levels:
            project.change_product_attribute(product.name, attribute_name, str(level_val))
            project.find_predicted_shares()
            level_values[level_name] = _rel_change(
                product.new_share, base_shares.get(product.product_id, 0.0)
            )
        if default is not None:
            project.change_product_attribute(product.name, attribute_name, str(default))
        rows.append({"name": product.name, "levels": level_values, "mode": "sku"})

    project.find_predicted_shares()
    return rows


def conditional_attribute_elasticity_per_group(
    project: "ProjectCore",
    attribute_name: str,
    group_type: str,
) -> list[dict]:
    """Sweep all SKUs in a group member together; read group NewShare elasticity."""
    model = project._model
    if model is None:
        return []
    project.find_predicted_shares()
    members = _group_members(model, group_type)
    base = {
        m: project.get_group_share("NewShare", group_type, m) for m in members
    }
    rows: list[dict] = []

    for member in members:
        products = _products_in_member(model, group_type, member)
        if not products:
            continue
        # Level columns from first product that has calibrated levels
        level_labels: list[str] = []
        per_product_levels: dict[str, list[tuple[str, float]]] = {}
        for p in products:
            lv = levels_for_attribute(model, p.name, attribute_name)
            per_product_levels[p.name] = lv
            if not level_labels and lv:
                level_labels = [name for name, _ in lv]
        if not level_labels:
            continue

        defaults = {
            p.name: p.new_attributes.get(attribute_name, p.base_attributes.get(attribute_name))
            for p in products
        }
        level_values: dict[str, float] = {}
        for idx, level_name in enumerate(level_labels):
            for p in products:
                lv = per_product_levels.get(p.name) or []
                if idx < len(lv):
                    project.change_product_attribute(p.name, attribute_name, str(lv[idx][1]))
            project.find_predicted_shares()
            level_values[level_name] = _rel_change(
                project.get_group_share("NewShare", group_type, member),
                base.get(member, 0.0),
            )
        _restore_defaults(project, products, attribute_name, defaults)
        rows.append({"name": member, "levels": level_values, "mode": "group"})

    project.find_predicted_shares()
    return rows


def conditional_attribute_elasticity_per_company_sku(
    project: "ProjectCore",
    attribute_name: str,
) -> list[dict]:
    """Sweep each SKU; readout is company NewShare relative change."""
    model = project._model
    if model is None:
        return []
    project.find_predicted_shares()
    company_base = project.get_company_share("NewShare")
    rows: list[dict] = []

    for product in list(model.included_products()):
        levels = levels_for_attribute(model, product.name, attribute_name)
        if not levels:
            continue
        default = product.new_attributes.get(attribute_name, product.base_attributes.get(attribute_name))
        level_values: dict[str, float] = {}
        for level_name, level_val in levels:
            project.change_product_attribute(product.name, attribute_name, str(level_val))
            project.find_predicted_shares()
            level_values[level_name] = _rel_change(
                project.get_company_share("NewShare"), company_base
            )
        if default is not None:
            project.change_product_attribute(product.name, attribute_name, str(default))
        rows.append({"name": product.name, "levels": level_values, "mode": "company_sku"})

    project.find_predicted_shares()
    return rows


def conditional_attribute_elasticity_per_company_group(
    project: "ProjectCore",
    attribute_name: str,
    group_type: str,
) -> list[dict]:
    """Sweep all SKUs in a group member; readout is company NewShare relative change."""
    model = project._model
    if model is None:
        return []
    project.find_predicted_shares()
    company_base = project.get_company_share("NewShare")
    members = _group_members(model, group_type)
    rows: list[dict] = []

    for member in members:
        products = _products_in_member(model, group_type, member)
        if not products:
            continue
        level_labels: list[str] = []
        per_product_levels: dict[str, list[tuple[str, float]]] = {}
        for p in products:
            lv = levels_for_attribute(model, p.name, attribute_name)
            per_product_levels[p.name] = lv
            if not level_labels and lv:
                level_labels = [name for name, _ in lv]
        if not level_labels:
            continue

        defaults = {
            p.name: p.new_attributes.get(attribute_name, p.base_attributes.get(attribute_name))
            for p in products
        }
        level_values: dict[str, float] = {}
        for idx, level_name in enumerate(level_labels):
            for p in products:
                lv = per_product_levels.get(p.name) or []
                if idx < len(lv):
                    project.change_product_attribute(p.name, attribute_name, str(lv[idx][1]))
            project.find_predicted_shares()
            level_values[level_name] = _rel_change(
                project.get_company_share("NewShare"), company_base
            )
        _restore_defaults(project, products, attribute_name, defaults)
        rows.append({"name": member, "levels": level_values, "mode": "company_group"})

    project.find_predicted_shares()
    return rows


def conditional_attribute_elasticity(
    project: "ProjectCore",
    attribute_name: str = "Price",
    *,
    mode: ElasticityMode = "sku",
    group_type: str = "Brand",
    product_name: str | None = None,
) -> list[dict]:
    if mode == "group":
        return conditional_attribute_elasticity_per_group(project, attribute_name, group_type)
    if mode == "company_sku":
        return conditional_attribute_elasticity_per_company_sku(project, attribute_name)
    if mode == "company_group":
        return conditional_attribute_elasticity_per_company_group(
            project, attribute_name, group_type
        )
    return conditional_attribute_elasticity_per_product(project, attribute_name, product_name)

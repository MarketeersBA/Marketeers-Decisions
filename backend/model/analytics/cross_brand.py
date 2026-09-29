"""Cross-brand interaction — ported from crossBrandInteractionPerProduct / PerGroup."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from model.analytics._helpers import clone_project

if TYPE_CHECKING:
    from model.project_core import ProjectCore

Level = Literal["sku", "group"]


def cross_brand_interaction_per_product(
    project: "ProjectCore",
    driver_product: str,
    price_multipliers: list[float] | None = None,
) -> dict:
    if price_multipliers is None:
        price_multipliers = [0.9, 1.0, 1.1]

    basic = clone_project(project)
    basic.find_predicted_shares()
    base_shares = {
        p.name: basic.get_product_share("NewShare", p.name)
        for p in basic._model.included_products()  # type: ignore[union-attr]
    }

    scenarios: dict[str, dict[str, float]] = {}
    model = project._model
    if model is None:
        return {"level": "sku", "products": [], "scenarios": scenarios}

    driver = model.get_product(driver_product)
    if driver is None:
        return {
            "level": "sku",
            "driverProduct": driver_product,
            "products": list(base_shares.keys()),
            "scenarios": scenarios,
        }

    base_price = float(
        driver.new_attributes.get("Price", driver.base_attributes.get("Price", 1.0)) or 1.0
    )

    for mult in price_multipliers:
        scenario = clone_project(project)
        new_price = base_price * mult
        scenario.change_product_attribute(driver_product, "Price", str(new_price))
        scenario.find_predicted_shares()
        label = f"{mult:.2f}x"
        scenarios[label] = {}
        for name in base_shares:
            delta = (
                scenario.get_product_share("NewShare", name) - base_shares[name]
            ) / 100.0
            scenarios[label][name] = delta

    return {
        "level": "sku",
        "driverProduct": driver_product,
        "products": list(base_shares.keys()),
        "scenarios": scenarios,
    }


def cross_brand_interaction_per_group(
    project: "ProjectCore",
    group_type: str,
    driver_product: str,
    price_multipliers: list[float] | None = None,
) -> dict:
    """Same price scenarios as PerProduct; rows are group members (brand totals)."""
    if price_multipliers is None:
        price_multipliers = [0.9, 1.0, 1.1]

    model = project._model
    if model is None:
        return {"level": "group", "groupType": group_type, "products": [], "scenarios": {}}

    members: list[str] = []
    seen: set[str] = set()
    for g in model.doc.groups:
        if g.group_type != group_type:
            continue
        if g.group_name not in seen:
            seen.add(g.group_name)
            members.append(g.group_name)

    basic = clone_project(project)
    basic.find_predicted_shares()
    base_shares = {
        m: basic.get_group_share("NewShare", group_type, m) for m in members
    }

    driver = model.get_product(driver_product)
    if driver is None:
        return {
            "level": "group",
            "groupType": group_type,
            "driverProduct": driver_product,
            "products": members,
            "scenarios": {},
        }

    base_price = float(
        driver.new_attributes.get("Price", driver.base_attributes.get("Price", 1.0)) or 1.0
    )

    scenarios: dict[str, dict[str, float]] = {}
    for mult in price_multipliers:
        scenario = clone_project(project)
        scenario.change_product_attribute(driver_product, "Price", str(base_price * mult))
        scenario.find_predicted_shares()
        label = f"{mult:.2f}x"
        scenarios[label] = {}
        for m in members:
            delta = (
                scenario.get_group_share("NewShare", group_type, m) - base_shares[m]
            ) / 100.0
            scenarios[label][m] = delta

    return {
        "level": "group",
        "groupType": group_type,
        "driverProduct": driver_product,
        "products": members,
        "scenarios": scenarios,
    }


def cross_brand_interaction(
    project: "ProjectCore",
    driver_product: str,
    *,
    level: Level = "sku",
    group_type: str = "Brand",
    price_multipliers: list[float] | None = None,
) -> dict:
    if level == "group":
        return cross_brand_interaction_per_group(
            project, group_type, driver_product, price_multipliers
        )
    return cross_brand_interaction_per_product(project, driver_product, price_multipliers)

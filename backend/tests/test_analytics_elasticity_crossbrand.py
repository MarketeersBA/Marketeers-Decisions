"""Tests for elasticity group/company variants and cross-brand PerGroup."""

from __future__ import annotations

from model.analytics.cross_brand import (
    cross_brand_interaction_per_group,
    cross_brand_interaction_per_product,
)
from model.analytics.elasticity import (
    conditional_attribute_elasticity_per_company_group,
    conditional_attribute_elasticity_per_company_sku,
    conditional_attribute_elasticity_per_group,
    conditional_attribute_elasticity_per_product,
)
from model.project_core import ProjectCore
from model.study_schema import GroupDef


def _ensure_brand_groups(project: ProjectCore) -> None:
    model = project._model
    assert model is not None
    if any(g.group_type == "Brand" for g in model.doc.groups):
        return
    names = list(model.all_product_names)
    if len(names) >= 2:
        mid = max(1, len(names) // 2)
        model.doc.groups.append(
            GroupDef(group_type="Brand", group_name="BrandA", product_names=names[:mid])
        )
        model.doc.groups.append(
            GroupDef(group_type="Brand", group_name="BrandB", product_names=names[mid:])
        )
    elif names:
        model.doc.groups.append(
            GroupDef(group_type="Brand", group_name="All", product_names=names)
        )


def test_elasticity_per_product(demo_slug: str) -> None:
    project = ProjectCore(demo_slug)
    project.initialize()
    rows = conditional_attribute_elasticity_per_product(project, "Price")
    assert rows
    assert "levels" in rows[0]


def test_elasticity_per_group(demo_slug: str) -> None:
    project = ProjectCore(demo_slug)
    project.initialize()
    _ensure_brand_groups(project)
    rows = conditional_attribute_elasticity_per_group(project, "Price", "Brand")
    assert rows
    assert rows[0]["mode"] == "group"
    assert rows[0]["levels"]


def test_elasticity_company_sku(demo_slug: str) -> None:
    project = ProjectCore(demo_slug)
    project.initialize()
    rows = conditional_attribute_elasticity_per_company_sku(project, "Price")
    assert rows
    assert rows[0]["mode"] == "company_sku"


def test_elasticity_company_group(demo_slug: str) -> None:
    project = ProjectCore(demo_slug)
    project.initialize()
    _ensure_brand_groups(project)
    rows = conditional_attribute_elasticity_per_company_group(project, "Price", "Brand")
    assert rows
    assert rows[0]["mode"] == "company_group"


def test_cross_brand_per_product(demo_slug: str) -> None:
    project = ProjectCore(demo_slug)
    project.initialize()
    driver = project._model.all_product_names[0]  # type: ignore[union-attr]
    data = cross_brand_interaction_per_product(project, driver)
    assert data["products"]
    assert data["scenarios"]


def test_cross_brand_per_group(demo_slug: str) -> None:
    project = ProjectCore(demo_slug)
    project.initialize()
    _ensure_brand_groups(project)
    driver = project._model.all_product_names[0]  # type: ignore[union-attr]
    data = cross_brand_interaction_per_group(project, "Brand", driver)
    assert data["level"] == "group"
    assert data["products"]
    assert data["scenarios"]
    # scenario values keyed by brand member
    first_sc = next(iter(data["scenarios"].values()))
    assert set(first_sc.keys()) == set(data["products"])

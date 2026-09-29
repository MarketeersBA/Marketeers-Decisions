"""Tests for FairShareOnBrands and cumulative incremental ports."""

from __future__ import annotations

import pytest

from model.analytics.fair_share import fair_share_on_brands, fair_share_on_skus
from model.analytics.incremental import (
    _base_scenario_value_share,
    cum_incremental_gain_loss,
    ex_incremental_gain_loss,
)
from model.project_core import ProjectCore


@pytest.fixture
def demo_slug() -> str:
    if not ProjectCore.study_exists("Demo_Study"):
        pytest.skip("Demo_Study not available")
    return "Demo_Study"


def test_fair_share_skus_has_index(demo_slug: str) -> None:
    project = ProjectCore(demo_slug)
    project.initialize()
    project.find_predicted_shares()
    names = project._model.all_product_names  # type: ignore[union-attr]
    focal = names[0]
    rows = fair_share_on_skus(project, focal)
    assert rows
    for row in rows:
        assert "fairShare" in row
        assert "index" in row
        if row["name"] == focal:
            assert row["fairShare"] == 0.0
            assert row["index"] == 0.0


def test_fair_share_brands_rows(demo_slug: str) -> None:
    project = ProjectCore(demo_slug)
    project.initialize()
    project.find_predicted_shares()
    model = project._model
    assert model is not None
    brands = [g.group_name for g in model.doc.groups if g.group_type == "Brand"]
    if not brands:
        # Synthesize a Brand group so the port can be exercised on Demo_Study
        from model.study_schema import GroupDef

        model.doc.groups.append(
            GroupDef(group_type="Brand", group_name="All", product_names=list(model.all_product_names))
        )
        brands = ["All"]
    rows = fair_share_on_brands(project, "Brand", brands[0])
    assert rows
    assert {r["name"] for r in rows} >= {brands[0]}


def test_cum_incremental_sorted_skips_negative_marginal(demo_slug: str) -> None:
    project = ProjectCore(demo_slug)
    project.initialize()
    project.find_predicted_shares()
    model = project._model
    assert model is not None
    names = list(model.all_product_names)
    if len(names) < 2:
        pytest.skip("Need 2+ products")

    rows = cum_incremental_gain_loss(
        project,
        "Intro",
        "Company Products",
        "",
        names[: min(6, len(names))],
        incremental_type="Value Share",
        current_lineup=[],
        intro_order="sorted",
    )
    product_rows = [r for r in rows if r["productName"] != "Current"]
    cumulative = [r["valueShare"] for r in product_rows]
    for i in range(1, len(cumulative)):
        assert cumulative[i] >= cumulative[i - 1] - 1e-9


def test_cum_incremental_sorted_intro_order(demo_slug: str) -> None:
    project = ProjectCore(demo_slug)
    project.initialize()
    project.find_predicted_shares()
    model = project._model
    assert model is not None
    names = list(model.all_product_names)
    if len(names) < 3:
        pytest.skip("Need 3+ products")
    candidates = names[:3]
    expected = sorted(
        candidates,
        key=lambda n: (-_base_scenario_value_share(project, n), n),
    )
    rows = cum_incremental_gain_loss(
        project,
        "Intro",
        "Company Products",
        "",
        candidates,
        incremental_type="Value Share",
        current_lineup=[],
        intro_order="sorted",
    )
    product_rows = [r for r in rows if r["productName"] != "Current"]
    assert [r["productName"] for r in product_rows] == expected
    assert rows[0].get("introOrder") == "sorted"
    assert product_rows[-1]["valueShare"] >= product_rows[0]["valueShare"]


def test_cum_incremental_orders_products(demo_slug: str) -> None:
    project = ProjectCore(demo_slug)
    project.initialize()
    project.find_predicted_shares()
    model = project._model
    assert model is not None
    names = list(model.all_product_names)
    if len(names) < 2:
        pytest.skip("Need 2+ products")
    # Remove last two from lineup, then Intro them cumulatively under Company Products
    lineup = names[:-2] if len(names) > 2 else []
    candidates = names[-2:]
    for n in candidates:
        p = model.get_product(n)
        if p:
            p.included = False
    project.find_predicted_shares()
    rows = cum_incremental_gain_loss(
        project,
        "Intro",
        "Company Products",
        "",
        candidates,
        incremental_type="Revenue",
        current_lineup=lineup,
    )
    assert rows[0]["productName"] == "Current"
    assert rows[0]["mode"] == "cumulative"
    assert len(rows) >= 2


def test_ex_incremental_independent(demo_slug: str) -> None:
    project = ProjectCore(demo_slug)
    project.initialize()
    project.find_predicted_shares()
    model = project._model
    assert model is not None
    names = list(model.all_product_names)
    if len(names) < 1:
        pytest.skip("No products")
    prods = names[:2]
    rows = ex_incremental_gain_loss(
        project,
        "Removal",
        "Company Products",
        "",
        prods,
        current_lineup=names,
    )
    assert rows[0]["productName"] == "Current"
    assert all(r.get("mode") == "exclusive" for r in rows)

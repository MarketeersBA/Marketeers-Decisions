"""Fair share — ported from FairShareOnSKUs / FairShareOnBrands."""

from __future__ import annotations

import math
from typing import TYPE_CHECKING, Literal

from model.analytics._helpers import clone_project

if TYPE_CHECKING:
    from model.project_core import ProjectCore

Level = Literal["sku", "group"]


def _finish_fair_share_table(table: list[dict], member_change: str) -> list[dict]:
    """Normalize shares to 100 and compute Actual / Fair Share / Index (shared by SKU + brand)."""
    num = sum(float(r["rebasedCurrentShare"]) for r in table)
    num2 = sum(float(r["newShare"]) for r in table)
    if num <= 0 or num2 <= 0:
        return []

    num3 = 0.0
    for row in table:
        row["rebasedCurrentShare"] = row["rebasedCurrentShare"] * 100.0 / num
        row["newShare"] = row["newShare"] * 100.0 / num2
        if row["name"] != member_change:
            num3 += row["rebasedCurrentShare"]

    num4 = 0.0
    for row in table:
        row["actualShare"] = abs(row["newShare"] - row["rebasedCurrentShare"])
        if row["name"] == member_change:
            num4 = row["actualShare"]
            row["rebaseto100Wot"] = row["rebasedCurrentShare"]
        else:
            row["rebaseto100Wot"] = (
                row["rebasedCurrentShare"] * 100.0 / num3 if num3 else 0.0
            )

    for row in table:
        if row["name"] != member_change:
            fair = abs(row["rebaseto100Wot"] * num4) / 100.0
            row["fairShare"] = fair
            if fair:
                idx = row["actualShare"] / fair
                row["index"] = None if math.isinf(idx) or math.isnan(idx) else idx
            else:
                row["index"] = None
        else:
            row["fairShare"] = 0.0
            row["index"] = 0.0

    return table


def fair_share_on_skus(
    project: "ProjectCore",
    member_change: str,
    *,
    basic: "ProjectCore | None" = None,
    scenario: "ProjectCore | None" = None,
) -> list[dict]:
    basic_proj = basic or clone_project(project)
    scenario_proj = scenario or project
    basic_proj.find_predicted_shares()
    scenario_proj.find_predicted_shares()

    model = project._model
    if model is None:
        return []

    table: list[dict] = []
    for p in model.products:
        if p.base_share == 0.0 and p.new_share == 0.0:
            continue
        if p.product_type == "ReplacedProduct" and p.base_product_id > 0:
            bp = basic_proj._model.product_by_id(p.base_product_id)  # type: ignore[union-attr]
            rebased_current = bp.new_share if bp else 0.0
        else:
            bp = basic_proj._model.get_product(p.name)  # type: ignore[union-attr]
            rebased_current = bp.new_share if bp else 0.0

        sp = scenario_proj._model.get_product(p.name)  # type: ignore[union-attr]
        new_share = sp.new_share if sp and p.included else 0.0

        table.append(
            {
                "name": p.name,
                "rebasedCurrentShare": rebased_current,
                "newShare": new_share,
            }
        )

    return _finish_fair_share_table(table, member_change)


def fair_share_on_brands(
    project: "ProjectCore",
    group_type: str,
    change_member: str,
    *,
    basic: "ProjectCore | None" = None,
    scenario: "ProjectCore | None" = None,
) -> list[dict]:
    """Port of FairShareOnBrands — same math at group-member rollup."""
    basic_proj = basic or clone_project(project)
    scenario_proj = scenario or project
    basic_proj.find_predicted_shares()
    scenario_proj.find_predicted_shares()

    model = project._model
    if model is None:
        return []

    members: list[str] = []
    seen: set[str] = set()
    for g in model.doc.groups:
        if g.group_type != group_type:
            continue
        if g.group_name not in seen:
            seen.add(g.group_name)
            members.append(g.group_name)

    table: list[dict] = []
    for item in members:
        rebased_current = basic_proj.get_group_share("NewShare", group_type, item)
        new_share = scenario_proj.get_group_share("NewShare", group_type, item)
        table.append(
            {
                "name": item,
                "rebasedCurrentShare": rebased_current,
                "newShare": new_share,
            }
        )

    return _finish_fair_share_table(table, change_member)


def fair_share(
    project: "ProjectCore",
    member_change: str,
    *,
    level: Level = "sku",
    group_type: str = "Brand",
    basic: "ProjectCore | None" = None,
    scenario: "ProjectCore | None" = None,
) -> list[dict]:
    if level == "group":
        return fair_share_on_brands(
            project, group_type, member_change, basic=basic, scenario=scenario
        )
    return fair_share_on_skus(project, member_change, basic=basic, scenario=scenario)

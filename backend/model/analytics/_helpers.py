"""Shared helpers for Chart Analysis analytics sweeps."""

from __future__ import annotations

import copy
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from model.project_core import ProjectCore
    from model.study_model import StudyModel


def _level_sort_key(name: str) -> tuple[int, str]:
    m = re.search(r"(\d+)", name)
    return (int(m.group(1)) if m else 0, name)


def conditional_levels_for_product(model: StudyModel, product_name: str) -> dict[str, list[tuple[str, float]]]:
    """Map attribute name -> [(level_label, value), ...] from study conditional_levels sheets."""
    by_attr: dict[str, list[tuple[str, float]]] = {}
    cond_attrs = list(model.conditional_attrs)
    for row in model.doc.conditional_levels:
        if row.product_name != product_name:
            continue
        levels = sorted(row.levels.items(), key=lambda x: _level_sort_key(x[0]))
        if not levels:
            continue
        name = (row.attribute_name or "").strip()
        if name:
            by_attr[name] = levels
            continue
        if len(cond_attrs) == 1:
            by_attr[cond_attrs[0]] = levels
            continue
        for attr in cond_attrs:
            attr_def = next((a for a in model.doc.attributes if a.name == attr), None)
            expected = max(attr_def.level_count, len(attr_def.level_names), 0) if attr_def else 0
            if expected and len(row.levels) == expected:
                by_attr[attr] = levels
                break
    return by_attr


def levels_for_attribute(model: StudyModel, product_name: str, attribute_name: str) -> list[tuple[str, float]]:
    rows = conditional_levels_for_product(model, product_name)
    if attribute_name in rows:
        return rows[attribute_name]
    # Fallback: single current value
    product = model.get_product(product_name)
    if product is None:
        return []
    val = product.new_attributes.get(attribute_name, product.base_attributes.get(attribute_name))
    try:
        return [("Current", float(val))]
    except (TypeError, ValueError):
        return []


def clone_project(project: "ProjectCore") -> "ProjectCore":
    from model.project_core import ProjectCore

    other = ProjectCore(project.slug)
    other.initialize()
    if project._model is None:
        return other
    other._model.products = copy.deepcopy(project._model.products)
    other._model.doc.groups = copy.deepcopy(project._model.doc.groups)
    other._model.active_segments = list(project._model.active_segments)
    other._model.respondent_selection = project._model.respondent_selection.copy()
    other._model._bind_get_attribute()
    other.scenario_name = project.scenario_name
    other.reload_results()
    return other


def apply_segment_filters(project: "ProjectCore", filters: list[tuple[str, str]]) -> None:
    project.apply_segmentation_filters(filters)


def prepare_analytics_project(
    slug: str,
    *,
    client_id: str | None = None,
    filters: list[tuple[str, str]] | None = None,
    base_scenario: str | None = None,
) -> "ProjectCore":
    from data.scenario_store import ScenarioStore
    from model.project_core import ProjectCore

    project = ProjectCore(slug, client_id=client_id)
    project.initialize()
    if base_scenario:
        store = ScenarioStore(slug, project.client_id)
        scenario = store.load(base_scenario)
        project.apply_scenario(scenario)
    else:
        project.reset_products()
    if filters:
        project.apply_segmentation_filters(filters)
    return project

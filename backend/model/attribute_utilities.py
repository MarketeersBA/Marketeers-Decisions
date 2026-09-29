"""HBU utility matrices and conditional attribute interpolation (ports Attributes.cs)."""

from __future__ import annotations

import math
import re

import numpy as np
import pandas as pd

from model.study_schema import AttributeDef, ConditionalLevelRow, StudyDocument


def _sorted_level_values(levels: dict[str, float]) -> list[float]:
    def key(name: str) -> tuple[int, str]:
        m = re.search(r"(\d+)", name)
        return (int(m.group(1)) if m else 0, name)

    return [levels[k] for k in sorted(levels.keys(), key=key)]


def _conditional_levels_by_product(
    doc: StudyDocument, attr: AttributeDef
) -> dict[int, dict[str, float]]:
    """Map product_id -> level grid for one conditional attribute.

    Prefers rows tagged with ``attribute_name``. Untagged legacy rows are matched
    by level count so Price/Size sheets no longer overwrite each other.
    """
    by_pid: dict[int, dict[str, float]] = {}
    expected = max(attr.level_count, len(attr.level_names), 0)
    untagged: list[ConditionalLevelRow] = []

    for row in doc.conditional_levels:
        name = (row.attribute_name or "").strip()
        if name:
            if name == attr.name:
                by_pid[row.product_id] = row.levels
            continue
        untagged.append(row)

    if by_pid:
        return by_pid

    conditional_attrs = [a for a in doc.attributes if a.attr_type == "Conditional"]
    if len(conditional_attrs) <= 1:
        return {row.product_id: row.levels for row in untagged}

    for row in untagged:
        if expected and len(row.levels) == expected:
            by_pid[row.product_id] = row.levels
    return by_pid


class AttributeUtilityModel:
    """Per-attribute respondent utility matrices loaded from HBU + conditional grids."""

    def __init__(self, doc: StudyDocument, hbu: pd.DataFrame, product_ids: list[int]) -> None:
        self.doc = doc
        self.hbu = hbu
        self.product_ids = product_ids
        self.n_respondents = len(hbu)
        self.n_products = len(product_ids)
        self.attributes: list[AttributeDef] = list(doc.attributes)
        self._utility: list[np.ndarray | None] = []
        self._conditional_grid: list[np.ndarray | None] = []
        self._build()

    def _build(self) -> None:
        pid_to_idx = {pid: i for i, pid in enumerate(self.product_ids)}

        for attr in self.attributes:
            if attr.is_sku or attr.name.upper() == "SKU":
                mat = np.zeros((self.n_respondents, self.n_products), dtype=float)
                for p_idx, pid in enumerate(self.product_ids):
                    col = f"ProductID{pid}"
                    if col in self.hbu.columns:
                        mat[:, p_idx] = pd.to_numeric(self.hbu[col], errors="coerce").fillna(0).to_numpy()
                self._utility.append(mat)
                self._conditional_grid.append(None)
                continue

            level_count = max(attr.level_count, len(attr.level_names), 1)
            mat = np.zeros((self.n_respondents, level_count), dtype=float)
            for lvl in range(1, level_count + 1):
                col = f"{attr.name}Level{lvl}"
                if col in self.hbu.columns:
                    mat[:, lvl - 1] = pd.to_numeric(self.hbu[col], errors="coerce").fillna(0).to_numpy()
            self._utility.append(mat)

            if attr.attr_type == "Conditional":
                cond_by_pid = _conditional_levels_by_product(self.doc, attr)
                grid = np.full((self.n_products, level_count), np.nan, dtype=float)
                for pdef in self.doc.products:
                    p_idx = pid_to_idx.get(pdef.product_id)
                    if p_idx is None:
                        continue
                    if pdef.product_id in cond_by_pid:
                        vals = _sorted_level_values(cond_by_pid[pdef.product_id])
                        for i, v in enumerate(vals[:level_count]):
                            grid[p_idx, i] = v
                    else:
                        base_val = pdef.base_attributes.get(attr.name)
                        if base_val is not None:
                            try:
                                grid[p_idx, 0] = float(base_val)
                            except (TypeError, ValueError):
                                pass
                self._conditional_grid.append(grid)
            else:
                self._conditional_grid.append(None)

    @staticmethod
    def _interpolate(
        prev_level: float,
        next_level: float,
        attr_value: float,
        prev_u: float,
        next_u: float,
    ) -> float:
        if next_level == prev_level:
            return next_u
        return next_u - (next_level - attr_value) * (next_u - prev_u) / (next_level - prev_level)

    def attribute_level_utility(
        self,
        attr_index: int,
        respondent_index: int,
        product_index: int,
        attr_value: float,
    ) -> float:
        attr = self.attributes[attr_index]
        mat = self._utility[attr_index]
        if mat is None:
            return 0.0

        if attr.attr_type == "Discrete" or attr.is_sku or attr.name.upper() == "SKU":
            idx = max(0, int(attr_value) - 1)
            if idx >= mat.shape[1]:
                idx = mat.shape[1] - 1
            return float(mat[respondent_index, idx])

        if attr.attr_type != "Conditional":
            return 0.0

        grid = self._conditional_grid[attr_index]
        if grid is None:
            return 0.0

        level_count = mat.shape[1]
        valid_levels: list[tuple[float, float, int]] = []
        for i in range(level_count):
            level_val = grid[product_index, i]
            if not math.isnan(level_val):
                valid_levels.append((level_val, float(mat[respondent_index, i]), i))

        if not valid_levels:
            return float("nan")
        if len(valid_levels) == 1:
            return valid_levels[0][1]

        valid_levels.sort(key=lambda x: x[0])
        if attr_value <= valid_levels[0][0]:
            v0, u0, _ = valid_levels[0]
            v1, u1, _ = valid_levels[1]
            return self._interpolate(v0, v1, attr_value, u0, u1)
        if attr_value >= valid_levels[-1][0]:
            v0, u0, _ = valid_levels[-2]
            v1, u1, _ = valid_levels[-1]
            return self._interpolate(v0, v1, attr_value, u0, u1)

        for k in range(1, len(valid_levels)):
            v0, u0, _ = valid_levels[k - 1]
            v1, u1, _ = valid_levels[k]
            if attr_value == v1:
                return u1
            if attr_value < v1:
                return self._interpolate(v0, v1, attr_value, u0, u1)
        return float("nan")

    def product_utility(
        self,
        respondent_index: int,
        product_index: int,
        attr_values: list[float],
        included_mask: list[bool],
        respondent_weight: float,
    ) -> float:
        total = 0.0
        for a_idx, (val, included) in enumerate(zip(attr_values, included_mask)):
            if not included:
                continue
            u = self.attribute_level_utility(a_idx, respondent_index, product_index, val)
            if math.isnan(u):
                raise ValueError(
                    f"Attribute {self.attributes[a_idx].name} out of bounds for product index {product_index}"
                )
            total += u
        return total * respondent_weight

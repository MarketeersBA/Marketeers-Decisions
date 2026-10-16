"""Vectorized price evaluator for brand optimization.

Adapted from sop_file_app/optimize.py FastEvaluator, but wired to StudyModel:
- Conditional Price interpolation matches preference_engine (absolute levels, not zero-price deltas)
- MNL uses respondent weights, exponent factor, and segmentation mask
- Share redistribution and metrics reuse share_calculator + metrics modules
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

import numpy as np

from model import metrics as _metrics
from model.share_calculator import calculate_new_shares
from model.study_model import StudyModel

ObjectiveName = Literal["revenue", "value_share", "volume_share", "margin"]


@dataclass
class DecisionVariable:
    sku: str
    product_idx: int
    min_val: float
    max_val: float
    base_price: float
    grid_prices: np.ndarray = field(repr=False)
    base_level: int = 0
    unit_cost: float = 0.0


@dataclass
class EvalResult:
    objective: float
    target_volume_share: float
    per_sku_volume_share: np.ndarray
    per_sku_value_share: np.ndarray
    per_sku_revenue: np.ndarray
    preference_shares: np.ndarray
    feasible: bool = True


def build_price_grid(
    base_price: float,
    lo: float,
    hi: float,
    step_pct: float,
    max_levels: int,
    *,
    current_price: float | None = None,
) -> np.ndarray:
    lo = float(lo)
    hi = float(hi)
    if hi <= lo:
        return np.array([lo])

    if step_pct > 0:
        step = max(abs(base_price) * step_pct, (hi - lo) / max(max_levels - 1, 1))
    else:
        step = (hi - lo) / max(max_levels - 1, 1)

    grid = np.arange(lo, hi + step * 0.5, step)
    grid = grid[(grid >= lo - 1e-9) & (grid <= hi + 1e-9)]
    if len(grid) == 0 or not np.isclose(grid[-1], hi):
        grid = np.unique(np.append(grid, hi))
    if current_price is not None:
        grid = np.unique(np.append(grid, float(current_price)))
        grid = grid[(grid >= lo - 1e-9) & (grid <= hi + 1e-9)]
    if len(grid) > max_levels:
        anchors = {lo, hi}
        if current_price is not None:
            anchors.add(float(current_price))
        grid = np.unique(np.append(np.linspace(lo, hi, max_levels), list(anchors)))
        grid = grid[(grid >= lo - 1e-9) & (grid <= hi + 1e-9)]
        if len(grid) > max_levels:
            grid = np.linspace(lo, hi, max_levels)
    return np.asarray(grid, dtype=float)


def _nearest_level_index(price: float, grid: np.ndarray) -> int:
    return int(np.argmin(np.abs(grid - price)))


def build_decision_variables(
    model: StudyModel,
    bounds: list[tuple[str, float, float, float, float]],
    *,
    step_pct: float = 0.01,
    max_levels: int = 100,
) -> list[DecisionVariable]:
    """Build decision variables from (sku, base_price, lo, hi, cost) tuples."""
    name_to_idx = {p.name: i for i, p in enumerate(model.products)}
    variables: list[DecisionVariable] = []
    for sku, base_price, lo, hi, cost in bounds:
        if sku not in name_to_idx:
            raise KeyError(f"Unknown SKU {sku!r}")
        idx = name_to_idx[sku]
        current = float(
            model.products[idx].new_attributes.get(
                "Price", model.products[idx].base_attributes.get("Price", base_price)
            )
            or base_price
        )
        grid = build_price_grid(base_price, lo, hi, step_pct, max_levels, current_price=current)
        variables.append(
            DecisionVariable(
                sku=sku,
                product_idx=idx,
                min_val=lo,
                max_val=hi,
                base_price=base_price,
                grid_prices=grid,
                base_level=_nearest_level_index(current, grid),
                unit_cost=cost,
            )
        )
    return variables


def _conditional_price_utility_vec(
    model: StudyModel, product_idx: int, price: float
) -> np.ndarray:
    """Per-respondent price utility at an absolute price (matches preference_engine)."""
    a_idx = model.price_attribute_index
    if a_idx < 0:
        return np.zeros(model.n_respondents, dtype=np.float64)

    util_model = model.utilities
    mat = util_model._utility[a_idx]
    grid = util_model._conditional_grid[a_idx]
    if mat is None or grid is None:
        return np.zeros(model.n_respondents, dtype=np.float64)

    val = float(price)
    n_levels = mat.shape[1]
    valid: list[tuple[float, int]] = [
        (float(grid[product_idx, i]), i)
        for i in range(n_levels)
        if not np.isnan(grid[product_idx, i])
    ]
    if not valid:
        return np.zeros(model.n_respondents, dtype=np.float64)
    if len(valid) == 1:
        return mat[:, valid[0][1]].copy()

    valid.sort(key=lambda x: x[0])
    if val <= valid[0][0]:
        v0, i0 = valid[0]
        v1, i1 = valid[1]
    elif val >= valid[-1][0]:
        v0, i0 = valid[-2]
        v1, i1 = valid[-1]
    else:
        v0, i0 = valid[-2]
        v1, i1 = valid[-1]
        for k in range(1, len(valid)):
            if val <= valid[k][0]:
                v0, i0 = valid[k - 1]
                v1, i1 = valid[k]
                break

    u0 = mat[:, i0]
    u1 = mat[:, i1]
    if v1 == v0:
        return u1.copy()
    coeff = (val - v0) / (v1 - v0)
    return u0 * (1.0 - coeff) + u1 * coeff


def _build_static_utility_matrix(model: StudyModel) -> np.ndarray:
    """SKU + discrete attribute utilities; excludes conditional Price."""
    products = model.products
    n_resp = model.n_respondents
    n_prod = len(products)
    util_model = model.utilities
    included_mask = [a.included for a in model.attributes]

    U = np.zeros((n_resp, n_prod), dtype=np.float64)
    attr_values_base = [model.product_attribute_values(p, use_new=False) for p in products]

    for a_idx, (attr, is_included) in enumerate(zip(model.attributes, included_mask)):
        if not is_included or attr.attr_type == "Conditional":
            continue
        mat = util_model._utility[a_idx]
        if mat is None:
            continue

        if attr.is_sku or attr.name.upper() == "SKU":
            if mat.shape[1] == n_prod:
                U += mat
        elif attr.attr_type == "Discrete":
            for j in range(n_prod):
                level_idx = max(0, int(attr_values_base[j][a_idx]) - 1)
                if level_idx >= mat.shape[1]:
                    level_idx = mat.shape[1] - 1
                U[:, j] += mat[:, level_idx]

    return U


def _compute_preference_shares_from_U(
    model: StudyModel, U: np.ndarray
) -> np.ndarray:
    """MNL preference shares (0–100) per product column; matches preference_engine."""
    products = model.products
    n_prod = len(products)
    weights = model.respondent_weights_raw()[:, np.newaxis]
    U = U * weights
    exp_util = np.exp(U * model.exponent)

    included_arr = np.array([p.included for p in products], dtype=np.float64)
    exp_incl = exp_util * included_arr[np.newaxis, :]
    denom = exp_incl.sum(axis=1, keepdims=True)
    denom = np.where(denom > 0, denom, 1.0)
    choice = exp_incl / denom

    selection = model.respondent_selection
    choice[~selection, :] = 0.0
    n_selected = int(selection.sum())
    if n_selected <= 0:
        return np.zeros(n_prod, dtype=np.float64)
    return choice.sum(axis=0) * 100.0 / n_selected


def _apply_prices(model: StudyModel, prices: dict[str, float]) -> None:
    for sku, price in prices.items():
        prod = model.get_product(sku)
        if prod is not None:
            prod.new_attributes["Price"] = float(price)


def _snapshot_prices(model: StudyModel, skus: list[str]) -> dict[str, float]:
    out: dict[str, float] = {}
    for sku in skus:
        prod = model.get_product(sku)
        if prod is None:
            continue
        out[sku] = float(
            prod.new_attributes.get("Price", prod.base_attributes.get("Price", 0.0)) or 0.0
        )
    return out


def _restore_prices(model: StudyModel, saved: dict[str, float]) -> None:
    for sku, price in saved.items():
        prod = model.get_product(sku)
        if prod is not None:
            prod.new_attributes["Price"] = price


def _reset_scenario_state(model: StudyModel) -> None:
    for p in model.products:
        p.current_share = p.base_share
        p.current_preference_share = p.base_preference_share


def _read_eval_arrays(model: StudyModel) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    n = len(model.products)
    vol = np.zeros(n, dtype=np.float64)
    val_sh = np.zeros(n, dtype=np.float64)
    rev = np.zeros(n, dtype=np.float64)
    pref = np.zeros(n, dtype=np.float64)
    for i, p in enumerate(model.products):
        vol[i] = p.new_share
        val_sh[i] = p.value_share
        rev[i] = p.revenue
        pref[i] = p.new_preference_share
    return vol, val_sh, rev, pref


def _objective_from_arrays(
    model: StudyModel,
    scope_mask: np.ndarray,
    objective: ObjectiveName,
    vol: np.ndarray,
    val_sh: np.ndarray,
    rev: np.ndarray,
    cost_by_idx: dict[int, float],
    prices_by_idx: dict[int, float],
) -> float:
    total = 0.0
    for i, p in enumerate(model.products):
        if not scope_mask[i] or not p.included:
            continue
        if objective == "revenue":
            total += rev[i]
        elif objective == "value_share":
            total += val_sh[i]
        elif objective == "volume_share":
            total += vol[i]
        elif objective == "margin":
            price_val = prices_by_idx.get(i, 1.0)
            cost = cost_by_idx.get(i, 0.0)
            if price_val > 0:
                total += rev[i] * max(price_val - cost, 0.0) / price_val
    return total


def _fast_pipeline(model: StudyModel) -> None:
    """Preference → share → metrics (matches model.optimizer._fast_pipeline)."""
    from model.preference_engine import compute_preference_shares

    _reset_scenario_state(model)
    new_pref = compute_preference_shares(model, use_new_attributes=True)
    for p in model.products:
        p.new_preference_share = new_pref.get(p.name, 0.0)
    calculate_new_shares(model)
    _metrics.apply_scenario_metrics(model)


def authoritative_evaluate(
    model: StudyModel,
    prices: dict[str, float],
    *,
    scope_skus: list[str],
    objective: ObjectiveName,
    cost_by_sku: dict[str, float] | None = None,
) -> EvalResult:
    """Full pipeline via existing modules — reference for parity tests."""
    skus = list(prices.keys())
    saved = _snapshot_prices(model, skus)
    try:
        _apply_prices(model, prices)
        _fast_pipeline(model)
        return _pack_eval_result(model, scope_skus, objective, cost_by_sku or {})
    finally:
        _restore_prices(model, saved)


def _pack_eval_result(
    model: StudyModel,
    scope_skus: list[str],
    objective: ObjectiveName,
    cost_by_sku: dict[str, float],
) -> EvalResult:
    scope_set = set(scope_skus)
    scope_mask = np.array([p.name in scope_set for p in model.products], dtype=bool)
    cost_by_idx = {
        i: cost_by_sku.get(p.name, 0.0) for i, p in enumerate(model.products)
    }
    prices_by_idx = {
        i: float(p.new_attributes.get("Price", p.base_attributes.get("Price", 1.0)) or 1.0)
        for i, p in enumerate(model.products)
    }
    vol, val_sh, rev, pref = _read_eval_arrays(model)
    obj = _objective_from_arrays(
        model, scope_mask, objective, vol, val_sh, rev, cost_by_idx, prices_by_idx
    )
    # Match _scope_volume_share / _objective_from_arrays: excluded SKUs contribute 0.
    included_mask = np.array([p.included for p in model.products], dtype=bool)
    target_vol = float(vol[scope_mask & included_mask].sum())
    return EvalResult(

        objective=obj,
        target_volume_share=target_vol,
        per_sku_volume_share=vol,
        per_sku_value_share=val_sh,
        per_sku_revenue=rev,
        preference_shares=pref,
    )


class FastEvaluator:
    """Precomputed price tables + vectorized MNL for optimizer inner loop."""

    def __init__(self, model: StudyModel, decision_skus: list[str]) -> None:
        if model.price_attribute_index < 0:
            raise ValueError("Price conditional attribute is required for FastEvaluator")

        self.model = model
        self.decision_skus = list(decision_skus)
        self._sku_to_idx = {p.name: i for i, p in enumerate(model.products)}
        for sku in self.decision_skus:
            if sku not in self._sku_to_idx:
                raise KeyError(f"Unknown decision SKU {sku!r}")

        self._n_prod = len(model.products)
        self._n_resp = model.n_respondents
        self._static_U = _build_static_utility_matrix(model)

        self._dec_indices = [self._sku_to_idx[s] for s in self.decision_skus]
        self._dec_set = set(self.decision_skus)

        self._variables: list[DecisionVariable] = []
        self._var_by_sku: dict[str, DecisionVariable] = {}
        self._price_tables: dict[str, np.ndarray] = {}
        self._scope_skus: list[str] = []
        self._scope_mask: np.ndarray | None = None
        self._objective: ObjectiveName = "revenue"
        self._max_volume_drop_pct: float | None = None
        self._baseline_brand_volume: float | None = None

    def configure(
        self,
        variables: list[DecisionVariable],
        *,
        scope_skus: list[str],
        objective: ObjectiveName,
        max_volume_drop_pct: float | None = None,
    ) -> None:
        self._variables = variables
        self._var_by_sku = {v.sku: v for v in variables}
        self._objective = objective
        self._max_volume_drop_pct = max_volume_drop_pct
        self._baseline_brand_volume = None
        self._scope_skus = list(scope_skus)
        scope_set = set(scope_skus)
        self._scope_mask = np.array(
            [p.name in scope_set for p in self.model.products], dtype=bool
        )

        self._price_tables = {}
        for var in variables:
            table = np.zeros((len(var.grid_prices), self._n_resp), dtype=np.float64)
            for li, price in enumerate(var.grid_prices):
                table[li] = _conditional_price_utility_vec(
                    self.model, var.product_idx, float(price)
                )
            self._price_tables[var.sku] = table

    def set_floor_baseline(self, baseline_brand_volume: float) -> None:
        self._baseline_brand_volume = float(baseline_brand_volume)

    def _apply_feasibility(self, result: EvalResult) -> EvalResult:
        if self._max_volume_drop_pct is None or self._baseline_brand_volume is None:
            result.feasible = True
        else:
            base = self._baseline_brand_volume
            if base <= 0:
                result.feasible = True
            else:
                drop_pct = (base - result.target_volume_share) / base * 100.0
                result.feasible = drop_pct <= float(self._max_volume_drop_pct) + 1e-9
        return result

    def evaluate_at_prices(
        self, prices: dict[str, float], *, restore_prices: bool = True
    ) -> EvalResult:
        """Fast path: vectorized preference + existing share/metrics modules."""
        if self._scope_mask is None:
            raise RuntimeError("FastEvaluator.configure() must be called first")

        full_prices = self._full_price_vector(prices)
        pref = self._preference_shares_for_prices(full_prices, use_tables=False)
        return self._finish_eval(prices, pref, restore_prices=restore_prices)

    def evaluate(self, level_indices: dict[str, int]) -> EvalResult:
        """Grid-index evaluation using precomputed price-utility tables."""
        if self._scope_mask is None:
            raise RuntimeError("FastEvaluator.configure() must be called first")

        pref = self._preference_shares_for_levels(level_indices)
        prices = {
            sku: float(self._var_by_sku[sku].grid_prices[level_indices[sku]])
            for sku in level_indices
            if sku in self._var_by_sku
        }
        return self._finish_eval(prices, pref)

    def evaluate_exact_prices_array(self, prices: np.ndarray) -> EvalResult:
        """Evaluate at a full per-product price vector (continuous parity checks)."""
        price_map = {
            self.model.products[i].name: float(prices[i])
            for i in self._dec_indices
        }
        return self.evaluate_at_prices(price_map)

    def _finish_eval(
        self, prices: dict[str, float], pref: np.ndarray, *, restore_prices: bool = True
    ) -> EvalResult:
        saved = _snapshot_prices(self.model, list(prices.keys())) if restore_prices else {}
        _apply_prices(self.model, prices)
        _reset_scenario_state(self.model)
        for i, p in enumerate(self.model.products):
            p.new_preference_share = float(pref[i])
        calculate_new_shares(self.model)
        _metrics.apply_scenario_metrics(self.model)
        result = _pack_eval_result(
            self.model,
            self._scope_skus,
            self._objective,
            {v.sku: v.unit_cost for v in self._variables},
        )
        result = self._apply_feasibility(result)
        if restore_prices:
            _restore_prices(self.model, saved)
        return result

    def _full_price_vector(self, decision_prices: dict[str, float]) -> np.ndarray:
        out = np.zeros(self._n_prod, dtype=np.float64)
        for j, prod in enumerate(self.model.products):
            if prod.name in decision_prices:
                out[j] = float(decision_prices[prod.name])
            else:
                out[j] = float(
                    prod.new_attributes.get("Price", prod.base_attributes.get("Price", 0.0)) or 0.0
                )
        return out

    def _preference_shares_for_prices(
        self, prices: np.ndarray, *, use_tables: bool = False
    ) -> np.ndarray:
        """Build U = static + price utilities, then MNL (matches preference_engine)."""
        U = self._static_U.copy()
        for j, prod in enumerate(self.model.products):
            price = float(prices[j])
            if use_tables and prod.name in self._price_tables:
                li = _nearest_level_index(price, self._var_by_sku[prod.name].grid_prices)
                U[:, j] += self._price_tables[prod.name][li]
            else:
                U[:, j] += _conditional_price_utility_vec(self.model, j, price)
        return _compute_preference_shares_from_U(self.model, U)

    def _preference_shares_for_levels(self, level_indices: dict[str, int]) -> np.ndarray:
        """Grid-index path using precomputed price-utility tables."""
        U = self._static_U.copy()
        for j, prod in enumerate(self.model.products):
            if prod.name in level_indices and prod.name in self._price_tables:
                li = level_indices[prod.name]
                U[:, j] += self._price_tables[prod.name][li]
            else:
                price = float(
                    prod.new_attributes.get("Price", prod.base_attributes.get("Price", 0.0)) or 0.0
                )
                U[:, j] += _conditional_price_utility_vec(self.model, j, price)
        return _compute_preference_shares_from_U(self.model, U)

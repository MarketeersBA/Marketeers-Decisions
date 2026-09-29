"""Parity tests: FastEvaluator vs authoritative simulation pipeline."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from config import STUDIES_DIR, ensure_directories
from model.optimizer import get_calibrated_bounds
from model.fast_evaluator import (
    FastEvaluator,
    authoritative_evaluate,
    build_decision_variables,
)
from model.project_core import ProjectCore, ProjectRegistry
from scripts.smoke_study import _create_demo_study


def _load_project(slug: str) -> ProjectCore:
    ensure_directories()
    if not (STUDIES_DIR / slug / "study.json").exists():
        raise unittest.SkipTest(f"Study not found: {slug}")
    ProjectRegistry.instance().clear()
    ProjectRegistry.instance().initialize_projects(slug)
    proj = ProjectCore(slug)
    proj.initialize()
    proj.reset_products()
    return proj


def _load_demo_project() -> ProjectCore:
    ensure_directories()
    slug = _create_demo_study()
    return _load_project(slug)


def _elaraby_company_bounds(project: ProjectCore, n: int = 5) -> tuple[list[str], list[tuple]]:
    model = project._model
    assert model is not None
    doc = model.doc
    df = project.results
    scope: list[str] = []
    bounds: list[tuple] = []
    for name in project.company_products:
        row = df[df["Product Name"] == name]
        if row.empty:
            continue
        r = row.iloc[0]
        base = float(r.get("Base Price", 0) or 0)
        if base <= 0:
            continue
        pid = int(r["Product Index"])
        lo, hi = get_calibrated_bounds(doc, pid, base)
        scope.append(name)
        bounds.append((name, base, lo, hi, 0.0))
        if len(scope) >= n:
            break
    if not scope:
        raise unittest.SkipTest("No company SKUs with base price in ELARABY study")
    return scope, bounds


class FastEvaluatorParityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.project = _load_demo_project()
        self.model = self.project._model
        assert self.model is not None
        self.skus = list(self.project.all_products)
        self.scope = self.skus[:2]
        self.bounds = []
        for sku in self.scope:
            prod = self.model.get_product(sku)
            assert prod is not None
            base = float(prod.base_attributes.get("Price", 10.0))
            self.bounds.append((sku, base, base * 0.7, base * 1.3, 0.0))

    def _setup_evaluator(self, objective: str = "revenue") -> FastEvaluator:
        variables = build_decision_variables(
            self.model, self.bounds, step_pct=0.02, max_levels=30
        )
        fe = FastEvaluator(self.model, [b[0] for b in self.bounds])
        fe.configure(variables, scope_skus=self.scope, objective=objective)  # type: ignore[arg-type]
        return fe

    def _assert_parity(self, prices: dict[str, float], objective: str = "revenue") -> None:
        auth = authoritative_evaluate(
            self.model,
            prices,
            scope_skus=self.scope,
            objective=objective,  # type: ignore[arg-type]
        )
        fe = self._setup_evaluator(objective)
        fast = fe.evaluate_at_prices(prices)

        for i, prod in enumerate(self.model.products):
            self.assertAlmostEqual(
                fast.per_sku_volume_share[i],
                auth.per_sku_volume_share[i],
                places=5,
                msg=f"volume share mismatch for {prod.name}",
            )
            self.assertAlmostEqual(
                fast.per_sku_revenue[i],
                auth.per_sku_revenue[i],
                places=4,
                msg=f"revenue mismatch for {prod.name}",
            )
            self.assertAlmostEqual(
                fast.per_sku_value_share[i],
                auth.per_sku_value_share[i],
                places=4,
                msg=f"value share mismatch for {prod.name}",
            )
            self.assertAlmostEqual(
                fast.preference_shares[i],
                auth.preference_shares[i],
                places=5,
                msg=f"preference share mismatch for {prod.name}",
            )

        self.assertAlmostEqual(fast.objective, auth.objective, places=4)
        self.assertAlmostEqual(
            fast.target_volume_share, auth.target_volume_share, places=5
        )

    def test_parity_base_prices(self) -> None:
        prices = {sku: base for sku, base, _, _, _ in self.bounds}
        self._assert_parity(prices)

    def test_parity_raised_prices(self) -> None:
        prices = {sku: hi * 0.95 for sku, _, _, hi, _ in self.bounds}
        self._assert_parity(prices)

    def test_parity_lowered_prices(self) -> None:
        prices = {sku: lo * 1.05 for sku, _, lo, _, _ in self.bounds}
        self._assert_parity(prices)

    def test_parity_value_share_objective(self) -> None:
        prices = {sku: base * 1.1 for sku, base, _, _, _ in self.bounds}
        self._assert_parity(prices, objective="value_share")

    def test_parity_volume_share_objective(self) -> None:
        prices = {sku: base * 0.9 for sku, base, _, _, _ in self.bounds}
        self._assert_parity(prices, objective="volume_share")

    def test_grid_eval_matches_exact_prices(self) -> None:
        fe = self._setup_evaluator()
        variables = build_decision_variables(
            self.model, self.bounds, step_pct=0.02, max_levels=30
        )
        for var in variables:
            li = min(3, len(var.grid_prices) - 1)
            level_indices = {var.sku: li}
            price = float(var.grid_prices[li])
            grid_result = fe.evaluate(level_indices)
            exact_result = fe.evaluate_at_prices({var.sku: price})
            self.assertAlmostEqual(
                grid_result.objective, exact_result.objective, places=4
            )


class ElarabyFastEvaluatorTests(unittest.TestCase):
    """Parity on real ELARABY PTV 2021 study (163 SKUs, 120 included)."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.project = _load_project("ELARABY_PTV_2021")
        cls.model = cls.project._model
        assert cls.model is not None
        cls.scope, cls.bounds = _elaraby_company_bounds(cls.project, n=5)

    def _assert_parity(self, prices: dict[str, float], objective: str = "revenue") -> None:
        auth = authoritative_evaluate(
            self.model,
            prices,
            scope_skus=self.scope,
            objective=objective,  # type: ignore[arg-type]
        )
        variables = build_decision_variables(
            self.model, self.bounds, step_pct=0.02, max_levels=30
        )
        fe = FastEvaluator(self.model, self.scope)
        fe.configure(variables, scope_skus=self.scope, objective=objective)  # type: ignore[arg-type]
        fast = fe.evaluate_at_prices(prices)

        self.assertAlmostEqual(fast.objective, auth.objective, places=3)
        for i, prod in enumerate(self.model.products):
            if prod.name not in self.scope:
                continue
            self.assertAlmostEqual(
                fast.per_sku_volume_share[i],
                auth.per_sku_volume_share[i],
                places=4,
                msg=prod.name,
            )
            self.assertAlmostEqual(
                fast.per_sku_revenue[i],
                auth.per_sku_revenue[i],
                places=2,
                msg=prod.name,
            )

    def test_elaraby_parity_base(self) -> None:
        prices = {sku: base for sku, base, _, _, _ in self.bounds}
        self._assert_parity(prices)

    def test_elaraby_parity_raised(self) -> None:
        prices = {sku: min(hi * 0.98, base * 1.1) for sku, base, lo, hi, _ in self.bounds}
        self._assert_parity(prices)

    def test_elaraby_parity_lowered(self) -> None:
        prices = {sku: max(lo * 1.02, base * 0.9) for sku, base, lo, hi, _ in self.bounds}
        self._assert_parity(prices)

    def test_elaraby_optimizer_revenue(self) -> None:
        from model.optimizer import OptSpec, PriceBound, optimize_coordinate_ascent

        bounds = [
            PriceBound(sku=n, base_price=bp, lo=lo, hi=hi)
            for n, bp, lo, hi, _ in self.bounds[:3]
        ]
        scope = [b.sku for b in bounds]
        spec = OptSpec(bounds=bounds, objective="revenue", scope_skus=scope, max_iters=3)
        proj = _load_project("ELARABY_PTV_2021")
        result = optimize_coordinate_ascent(proj, spec)
        self.assertGreaterEqual(result.objective_value, result.baseline_value - 1e-6)
        self.assertGreater(result.n_evals, 0)


    def test_elaraby_parity_with_segment(self) -> None:
        proj = _load_project("ELARABY_PTV_2021")
        model = proj._model
        assert model is not None
        scope, bounds = _elaraby_company_bounds(proj, n=3)
        model.set_segmentation("Segment Gender", "1")
        n_sel = int(model.respondent_selection.sum())
        self.assertGreater(n_sel, 0)
        self.assertLess(n_sel, model.n_respondents)

        prices = {sku: base for sku, base, _, _, _ in bounds}
        auth = authoritative_evaluate(
            model, prices, scope_skus=scope, objective="revenue"
        )
        variables = build_decision_variables(model, bounds, step_pct=0.02, max_levels=30)
        fe = FastEvaluator(model, scope)
        fe.configure(variables, scope_skus=scope, objective="revenue")
        fast = fe.evaluate_at_prices(prices)
        self.assertAlmostEqual(fast.objective, auth.objective, places=3)


    def test_elaraby_floor_rejects_excessive_loss(self) -> None:
        from model.optimizer import OptSpec, PriceBound, optimize_grid

        proj = _load_project("ELARABY_PTV_2021")
        model = proj._model
        assert model is not None
        scope, bounds = _elaraby_company_bounds(proj, n=1)
        sku, base, lo, hi, _ = bounds[0]
        spec = OptSpec(
            bounds=[PriceBound(sku=sku, base_price=base, lo=lo, hi=hi)],
            objective="revenue",
            scope_skus=scope,
            grid_points=10,
            max_volume_drop_pct=0.0,
        )
        result = optimize_grid(proj, spec)
        self.assertLessEqual(result.brand_volume_drop_pct, 1e-6)
        self.assertGreaterEqual(result.objective_value, result.baseline_value - 1e-6)


class FastEvaluatorSanityTests(unittest.TestCase):
    def test_preference_shares_sum_near_100(self) -> None:
        project = _load_demo_project()
        model = project._model
        assert model is not None
        skus = project.all_products
        bounds = []
        for sku in skus:
            prod = model.get_product(sku)
            assert prod is not None
            base = float(prod.base_attributes.get("Price", 10.0))
            bounds.append((sku, base, base * 0.6, base * 1.4, 0.0))
        variables = build_decision_variables(model, bounds)
        fe = FastEvaluator(model, skus)
        fe.configure(variables, scope_skus=skus, objective="volume_share")
        result = fe.evaluate_at_prices(
            {sku: base for sku, base, _, _, _ in bounds}
        )
        total_pref = float(result.preference_shares.sum())
        self.assertGreater(total_pref, 95.0)
        self.assertLess(total_pref, 105.0)


if __name__ == "__main__":
    unittest.main()

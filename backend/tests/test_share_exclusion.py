"""Share calculation when products are excluded from the lineup."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from config import STUDIES_DIR, ensure_directories
from model.attribute_engine import AttributeEngine
from model.fast_evaluator import _pack_eval_result
from model import metrics as metrics_mod
from model.project_core import ProjectCore, ProjectRegistry
from model.share_calculator import calculate_new_shares
from model.study_model import ProductState, StudyModel


def _load_elaraby() -> ProjectCore:
    ensure_directories()
    if not (STUDIES_DIR / "ELARABY_PTV_2021" / "study.json").exists():
        raise unittest.SkipTest("ELARABY study not available")
    ProjectRegistry.instance().clear()
    ProjectRegistry.instance().initialize_projects("ELARABY_PTV_2021")
    return ProjectRegistry.instance().get("MainStudy")


def _product(
    name: str,
    *,
    pid: int = 1,
    included: bool = True,
    new_share: float = 10.0,
    pref: float = 10.0,
) -> ProductState:
    return ProductState(
        product_id=pid,
        name=name,
        company="Co",
        included=included,
        base_share=8.0,
        base_wd=100.0,
        new_wd=100.0,
        new_share=new_share,
        new_preference_share=pref,
        current_share=8.0,
        current_preference_share=8.0,
        revenue=50.0,
        value_sales_unit=5.0,
        value_share=12.0,
        penetration=3.0,
        new_attributes={"Price": 10.0},
        base_attributes={"Price": 10.0},
    )


def _bare_model(products: list[ProductState]) -> StudyModel:
    model = StudyModel.__new__(StudyModel)
    model.products = products
    model.msu = 1.0
    model.su = 1.0
    model.vsu = 0.0
    model.price_attribute_index = -1
    model.size_attribute_index = -1
    model.get_product = lambda name: next((p for p in model.products if p.name == name), None)  # type: ignore[method-assign]
    model.product_by_id = lambda pid: next((p for p in model.products if p.product_id == pid), None)  # type: ignore[method-assign]
    return model


class ExcludeClearUnitTests(unittest.TestCase):
    def test_include_exclude_zeros_shares(self) -> None:
        p = _product("A", new_share=7.5, pref=4.0)
        model = _bare_model([p])
        AttributeEngine().include_exclude(model, "A", False)
        self.assertFalse(p.included)
        self.assertEqual(p.new_share, 0.0)
        self.assertEqual(p.new_preference_share, 0.0)

    def test_wd_zero_excludes_and_clears_shares(self) -> None:
        p = _product("A", new_share=7.5, pref=4.0)
        model = _bare_model([p])
        AttributeEngine().change(model, "A", "WD", "0")
        self.assertFalse(p.included)
        self.assertEqual(p.new_wd, 0.0)
        self.assertEqual(p.new_share, 0.0)
        self.assertEqual(p.new_preference_share, 0.0)

    def test_calculate_new_shares_zeros_excluded(self) -> None:
        included = _product("In", pid=1, included=True, new_share=10.0, pref=50.0)
        excluded = _product("Out", pid=2, included=False, new_share=9.0, pref=40.0)
        model = _bare_model([included, excluded])
        calculate_new_shares(model)
        self.assertEqual(excluded.new_share, 0.0)
        self.assertEqual(excluded.new_preference_share, 0.0)
        self.assertGreater(included.new_share, 0.0)

    def test_apply_scenario_metrics_zeros_excluded(self) -> None:
        included = _product("In", pid=1, included=True, new_share=10.0)
        excluded = _product("Out", pid=2, included=False, new_share=0.0)
        excluded.revenue = 99.0
        excluded.value_share = 88.0
        excluded.value_sales_unit = 77.0
        excluded.penetration = 66.0
        model = _bare_model([included, excluded])
        metrics_mod.apply_scenario_metrics(model)
        self.assertEqual(excluded.revenue, 0.0)
        self.assertEqual(excluded.value_share, 0.0)
        self.assertEqual(excluded.value_sales_unit, 0.0)
        self.assertEqual(excluded.penetration, 0.0)
        self.assertGreater(included.revenue, 0.0)

    def test_fast_eval_target_volume_ignores_excluded_in_scope(self) -> None:
        included = _product("In", pid=1, included=True, new_share=10.0)
        excluded = _product("Out", pid=2, included=False, new_share=5.0)  # stale
        model = _bare_model([included, excluded])
        result = _pack_eval_result(model, ["In", "Out"], "volume_share", {})
        self.assertAlmostEqual(result.target_volume_share, 10.0)


class ShareExclusionTests(unittest.TestCase):
    def test_exclude_preserves_base_preference_for_ratio(self) -> None:
        """Delisting must compare new pref vs original-lineup base pref (reference parity)."""
        project = _load_elaraby()
        smt = "TOSHIBA 32 SMT HD"
        hd = "TOSHIBA 32 HD"

        base_row = project.results[project.results["Product Name"] == smt].iloc[0]
        self.assertAlmostEqual(float(base_row["B.Share"]), 0.5450752742027009, places=6)

        project.include_exclude_product(hd, False)
        row = project.results[project.results["Product Name"] == smt].iloc[0]

        # Reference Market Simulator value when TOSHIBA 32 HD is deselected.
        self.assertAlmostEqual(float(row["N.Share"]), 0.599705311411276, places=6)
        self.assertAlmostEqual(
            float(row["N.Share"]) / float(row["B.Share"]),
            1.100225,
            places=4,
        )

        model = project._model
        assert model is not None
        p_smt = model.get_product(smt)
        assert p_smt is not None
        self.assertAlmostEqual(p_smt.base_preference_share, 2.298950878503537, places=6)
        self.assertAlmostEqual(p_smt.new_preference_share, 2.4463980505480967, places=6)
        self.assertGreater(p_smt.new_preference_share, p_smt.base_preference_share)

    def test_exclude_zeros_model_fields_and_totals(self) -> None:
        """Excluded SKUs must contribute 0 to model state and all-product totals."""
        project = _load_elaraby()
        hd = "TOSHIBA 32 HD"
        model = project._model
        assert model is not None
        p_hd = model.get_product(hd)
        assert p_hd is not None
        self.assertGreater(p_hd.new_share, 0.0)

        project.include_exclude_product(hd, False)

        p_hd = model.get_product(hd)
        assert p_hd is not None
        self.assertFalse(p_hd.included)
        self.assertEqual(p_hd.new_share, 0.0)
        self.assertEqual(p_hd.new_preference_share, 0.0)
        self.assertEqual(p_hd.revenue, 0.0)
        self.assertEqual(p_hd.value_share, 0.0)
        self.assertEqual(p_hd.penetration, 0.0)

        included_sum = sum(p.new_share for p in model.products if p.included)
        self.assertAlmostEqual(project.get_total_products_new_share(), included_sum, places=9)

        row = project.results[project.results["Product Name"] == hd].iloc[0]
        self.assertEqual(float(row["N.Share"]), 0.0)
        self.assertEqual(float(row["Revenue"]), 0.0)

    def test_wd_zero_excludes_and_clears_shares_integration(self) -> None:
        project = _load_elaraby()
        hd = "TOSHIBA 32 HD"
        project.change_product_attribute(hd, "WD", "0")

        model = project._model
        assert model is not None
        p_hd = model.get_product(hd)
        assert p_hd is not None
        self.assertFalse(p_hd.included)
        self.assertEqual(p_hd.new_share, 0.0)
        self.assertEqual(p_hd.new_preference_share, 0.0)


if __name__ == "__main__":
    unittest.main()

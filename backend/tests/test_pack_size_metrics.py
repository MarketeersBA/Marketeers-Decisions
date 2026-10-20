"""Pack-size basis for revenue / VSU / unit price (issue #17)."""

from __future__ import annotations

import math
import sys
import unittest
import unittest.mock
from pathlib import Path
from types import SimpleNamespace

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from model import metrics as metrics_mod
from model.optimizer import get_sku_size
from model.study_model import ProductState, StudyModel
from model.study_schema import ProductDef, StudyDocument, StudyMeta


def _product(
    *,
    name: str = "SKU",
    base_size: float = 1.0,
    scenario_size: float | None = None,
    price: float = 2.0,
    new_share: float = 12.0,
    base_share: float = 10.0,
) -> ProductState:
    size = scenario_size if scenario_size is not None else base_size
    return ProductState(
        product_id=1,
        name=name,
        company="Co",
        included=True,
        base_share=base_share,
        base_wd=100.0,
        new_wd=100.0,
        new_share=new_share,
        current_share=base_share,
        size_unit=base_size,
        base_attributes={"Price": price, "Size": base_size},
        new_attributes={"Price": price, "Size": size},
    )


def _bare_model(products: list[ProductState], *, msu: float = 100.0, su: float = 1.0) -> StudyModel:
    model = StudyModel.__new__(StudyModel)
    model.products = products
    model.msu = msu
    model.su = su
    model.vsu = 0.0
    model.price_attribute_index = -1
    model.size_attribute_index = -1
    model.doc = SimpleNamespace(meta=SimpleNamespace(size_attribute="Size"))
    model.get_product = lambda name: next(  # type: ignore[method-assign]
        (p for p in model.products if p.name == name), None
    )
    model.included_products = lambda: [p for p in model.products if p.included]  # type: ignore[method-assign]
    return model


class PackSizeMetricsTests(unittest.TestCase):
    def test_unchanged_size_matches_legacy_denominator(self) -> None:
        """Price unchanged, size unchanged → same as dividing by frozen size_unit."""
        p = _product(base_size=1.0, scenario_size=1.0, price=2.0, new_share=12.0)
        model = _bare_model([p], msu=100.0, su=1.0)
        metrics_mod.apply_scenario_metrics(model)
        # revenue = MSU * SU * share * price / (size * 100) = 100 * 1 * 12 * 2 / 100 = 24
        self.assertAlmostEqual(p.revenue, 24.0)
        self.assertAlmostEqual(p.value_sales_unit, 24.0)

    def test_scenario_size_halves_revenue_when_pack_doubles(self) -> None:
        """1L → 2L, price €2, share 12%: €/L halves so revenue/VSU are half of base-size formula."""
        p = _product(base_size=1.0, scenario_size=2.0, price=2.0, new_share=12.0)
        # Frozen size_unit still 1.0 (legacy bug path would divide by 1)
        self.assertEqual(p.size_unit, 1.0)
        model = _bare_model([p], msu=100.0, su=1.0)
        metrics_mod.apply_scenario_metrics(model)
        # With scenario size 2: 100 * 12 * 2 / (2 * 100) = 12
        self.assertAlmostEqual(p.revenue, 12.0)
        self.assertAlmostEqual(p.value_sales_unit, 12.0)
        # Legacy (base size) would have been 24
        legacy = model.msu * model.su * p.new_share * 2.0 / (p.size_unit * 100.0)
        self.assertAlmostEqual(legacy, 24.0)
        self.assertAlmostEqual(p.revenue, legacy / 2.0)

    def test_base_metrics_keep_base_pack_size(self) -> None:
        p = _product(base_size=1.0, scenario_size=2.0, price=2.0, base_share=10.0)
        model = _bare_model([p], msu=100.0, su=1.0)
        model.base_inclusion = lambda: {prod.name: True for prod in model.products}  # type: ignore[method-assign]

        def fake_pref(m, use_new_attributes=False, inclusion=None):
            return {prod.name: prod.base_share for prod in m.products}

        with unittest.mock.patch(
            "model.preference_engine.compute_preference_shares", side_effect=fake_pref
        ):
            metrics_mod.apply_base_metrics(model)

        # Base uses 1L: 100 * 10 * 2 / 100 = 20
        self.assertAlmostEqual(p.base_revenue, 20.0)
        self.assertAlmostEqual(p.base_value_sales_unit, 20.0)

    def test_pack_size_accessor_prefers_scenario(self) -> None:
        p = _product(base_size=1.0, scenario_size=2.0)
        model = _bare_model([p])
        self.assertAlmostEqual(metrics_mod.pack_size(p, model, use_new=True), 2.0)
        self.assertAlmostEqual(metrics_mod.pack_size(p, model, use_new=False), 1.0)

    def test_get_sku_size_uses_scenario_when_model_provided(self) -> None:
        doc = StudyDocument(
            meta=StudyMeta(size_attribute="Size"),
            products=[ProductDef(1, "SKU", base_attributes={"Size": 1.0})],
        )
        p = _product(base_size=1.0, scenario_size=2.5)
        model = _bare_model([p])
        self.assertAlmostEqual(get_sku_size(doc, "SKU"), 1.0)
        self.assertAlmostEqual(get_sku_size(doc, "SKU", model=model), 2.5)

    def test_unit_price_for_ppa(self) -> None:
        """Hand check: €2 / 2L = €1/L when scenario size is used."""
        p = _product(base_size=1.0, scenario_size=2.0, price=2.0)
        model = _bare_model([p])
        sz = metrics_mod.pack_size(p, model, use_new=True)
        unit = 2.0 / sz
        self.assertTrue(math.isclose(unit, 1.0))
        self.assertFalse(math.isclose(2.0 / p.size_unit, unit))


if __name__ == "__main__":
    unittest.main()

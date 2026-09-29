"""Competitor price shocks become the optimizer starting market."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from model.optimizer import apply_competitor_price_moves


class _Product:
    def __init__(self, name: str, price: float):
        self.name = name
        self.base_attributes = {"Price": price}
        self.new_attributes = {"Price": price}


class _Model:
    def __init__(self, products: list[_Product]):
        self.products = products
        self._by_name = {p.name: p for p in products}

    def get_product(self, name: str) -> _Product | None:
        return self._by_name.get(name)


class _Engine:
    def change(self, model: _Model, product_name: str, attribute: str, value: str) -> None:
        product = model.get_product(product_name)
        if product is None:
            return
        product.new_attributes[attribute] = float(value)


class _Project:
    def __init__(self, products: list[_Product]):
        self._model = _Model(products)
        self._attr_engine = _Engine()
        self.reload_count = 0

    def reload_results(self) -> None:
        self.reload_count += 1


_GROUPS = {
    "Focus": ["Focus Ref"],
    "Rival": ["Rival A", "Rival B"],
}


def test_apply_competitor_price_moves_scales_named_brand_skus() -> None:
    rival_a = _Product("Rival A", 10.0)
    rival_b = _Product("Rival B", 20.0)
    focus = _Product("Focus Ref", 8.0)
    project = _Project([rival_a, rival_b, focus])

    with patch("model.optimizer.get_optimizer_groups", return_value=_GROUPS):
        changed = apply_competitor_price_moves(
            project,
            "Brand",
            [{"brand": "Rival", "pct": 10}],
            skip_brands={"Focus"},
        )

    assert changed == 2
    assert rival_a.new_attributes["Price"] == 11.0
    assert rival_b.new_attributes["Price"] == 22.0
    assert focus.new_attributes["Price"] == 8.0
    assert project.reload_count == 1


def test_zero_and_skipped_moves_are_noops() -> None:
    rival_a = _Product("Rival A", 10.0)
    focus = _Product("Focus Ref", 8.0)
    project = _Project([rival_a, focus])

    with patch("model.optimizer.get_optimizer_groups", return_value=_GROUPS):
        changed = apply_competitor_price_moves(
            project,
            "Brand",
            [
                {"brand": "Rival", "pct": 0},
                SimpleNamespace(brand="Focus", pct=5),
            ],
            skip_brands={"Focus"},
        )

    assert changed == 0
    assert rival_a.new_attributes["Price"] == 10.0
    assert focus.new_attributes["Price"] == 8.0
    assert project.reload_count == 0

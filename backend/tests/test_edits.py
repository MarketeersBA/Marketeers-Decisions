"""Grid edit validation: price % expansion, floor, Selected coercion."""

from __future__ import annotations

from api.edits import apply_grid_changes
from api.schemas import GridChange


class _Product:
    def __init__(self, name: str, price: float):
        self.name = name
        self.base_attributes = {"Price": price}
        self.new_attributes = {"Price": price}
        self.included = True
        self.new_wd = 100.0


class _Model:
    def __init__(self, products: list[_Product]):
        self.products = products
        self.discrete_attrs: list[str] = []
        self._by_name = {p.name: p for p in products}

    def get_product(self, name: str) -> _Product | None:
        return self._by_name.get(name)


class _Project:
    def __init__(self, products: list[_Product]):
        self._model = _Model(products)
        self.discrete_attributes: list[str] = []
        self.calls: list[tuple] = []

    def change_product_attribute(
        self, product: str, attribute: str, value: str, *, reload: bool = True
    ) -> None:
        self.calls.append(("attr", product, attribute, value))
        p = self._model.get_product(product)
        if p is None:
            return
        if attribute == "Price":
            # Mirror AttributeEngine % expansion so tests catch double-expand bugs.
            clean = value.strip()
            if "%" in clean:
                base = float(p.new_attributes.get("Price", p.base_attributes.get("Price", 0)))
                pct = float(clean.replace("%", "")) / 100.0
                p.new_attributes["Price"] = base * (1 + pct)
            else:
                p.new_attributes["Price"] = float(clean)
        elif attribute == "WD":
            p.new_wd = float(str(value).replace("%", ""))

    def include_exclude_product(
        self, product: str, include: bool, *, reload: bool = True
    ) -> None:
        self.calls.append(("include", product, include))
        p = self._model.get_product(product)
        if p:
            p.included = include


def test_price_pct_below_minus_100_is_clamped() -> None:
    sku = _Product("SKU A", 10.0)
    project = _Project([sku])

    applied, warnings = apply_grid_changes(
        project,
        [GridChange(product="SKU A", column="New Price", value="-150%")],
    )

    assert applied == 1
    assert any("0.01" in w for w in warnings)
    assert sku.new_attributes["Price"] == 0.01
    # Must send absolute value, not a % string (would re-expand).
    assert project.calls[-1] == ("attr", "SKU A", "Price", "0.01")


def test_price_pct_positive_expands_then_applies() -> None:
    sku = _Product("SKU A", 10.0)
    project = _Project([sku])

    applied, warnings = apply_grid_changes(
        project,
        [GridChange(product="SKU A", column="New Price", value="5%")],
    )

    assert applied == 1
    assert warnings == []
    assert sku.new_attributes["Price"] == 10.5


def test_absolute_negative_price_clamped() -> None:
    sku = _Product("SKU A", 10.0)
    project = _Project([sku])

    applied, warnings = apply_grid_changes(
        project,
        [GridChange(product="SKU A", column="New Price", value="-5")],
    )

    assert applied == 1
    assert any("0.01" in w for w in warnings)
    assert sku.new_attributes["Price"] == 0.01


def test_nonfinite_price_clamped() -> None:
    sku = _Product("SKU A", 10.0)
    project = _Project([sku])

    applied, warnings = apply_grid_changes(
        project,
        [GridChange(product="SKU A", column="New Price", value="inf")],
    )

    assert applied == 1
    assert any("finite" in w for w in warnings)
    assert sku.new_attributes["Price"] == 0.01


def test_unknown_product_not_applied() -> None:
    project = _Project([_Product("SKU A", 10.0)])

    applied, warnings = apply_grid_changes(
        project,
        [GridChange(product="Missing", column="New Price", value="5")],
    )

    assert applied == 0
    assert project.calls == []
    assert any("Unknown product" in w for w in warnings)


def test_selected_string_false_excludes() -> None:
    sku = _Product("SKU A", 10.0)
    project = _Project([sku])

    applied, warnings = apply_grid_changes(
        project,
        [GridChange(product="SKU A", column="Selected", value="false")],
    )

    assert applied == 1
    assert warnings == []
    assert sku.included is False
    assert project.calls[-1] == ("include", "SKU A", False)

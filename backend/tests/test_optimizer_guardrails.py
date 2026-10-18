"""Margin floor, limited_by attribution, and menu construction guardrails."""

from __future__ import annotations

from model.optimizer import (
    OptSpec,
    PriceBound,
    _build_menus,
    _ceil_money,
    _constraints_ok,
    _sku_limited_by,
    apply_guardrail_bounds,
    _margin_floor_price,
)


def _spec(**kwargs) -> OptSpec:
    bounds = kwargs.pop(
        "bounds",
        [
            PriceBound(sku="A", base_price=10.0, lo=5.0, hi=20.0, cost=5.8),
            PriceBound(sku="B", base_price=15.0, lo=8.0, hi=30.0, cost=8.0),
        ],
    )
    return OptSpec(
        bounds=bounds,
        objective="revenue",
        scope_skus=[b.sku for b in bounds],
        **kwargs,
    )


def test_margin_floor_price() -> None:
    assert abs(_margin_floor_price(5.8, 0.30) - (5.8 / 0.70)) < 1e-9


def test_apply_guardrail_tightens_by_margin() -> None:
    spec = _spec(min_margin_pct=0.30)
    msgs = apply_guardrail_bounds(spec)
    assert msgs == []
    a = spec.bounds[0]
    floor = 5.8 / 0.70
    # lo = max(5.0, margin floor); hi unchanged
    assert abs(a.lo - floor) < 1e-9
    assert abs(a.hi - 20.0) < 1e-9


def test_margin_rejects_below_floor() -> None:
    spec = _spec(min_margin_pct=0.30)
    apply_guardrail_bounds(spec)
    # After tighten A.lo ≈ 8.29; a price below that should fail margin check on original cost
    assert _constraints_ok(spec, {"A": 7.0, "B": 15.0}) is False
    assert _constraints_ok(spec, {"A": 9.0, "B": 15.0}) is True


def test_limited_by_margin_floor() -> None:
    spec = _spec(min_margin_pct=0.30)
    apply_guardrail_bounds(spec)
    floor = _margin_floor_price(5.8, 0.30)
    assert floor is not None
    limited = _sku_limited_by(spec, {"A": floor, "B": 15.0})
    assert limited.get("A") == "margin_floor"


def test_menu_ceil_margin_floor_survives_cent_rounding() -> None:
    """Afia Corn 9L-style: cost/0.8 rounds down to a price that is < 20% margin."""
    cost = 60.218
    floor = _margin_floor_price(cost, 0.20)
    assert floor is not None
    assert round(floor, 2) < floor  # naive round undercuts the floor
    assert (round(floor, 2) - cost) / round(floor, 2) < 0.20

    spec = _spec(
        bounds=[PriceBound(sku="9L", base_price=94.5, lo=44.6, hi=211.85, cost=cost)],
        min_margin_pct=0.20,
    )
    menus, msgs = _build_menus(spec, max_menu=15)
    assert msgs == []
    assert menus["9L"]
    assert menus["9L"][0] == _ceil_money(floor)
    for p in menus["9L"]:
        assert (p - cost) / p >= 0.20 - 1e-9

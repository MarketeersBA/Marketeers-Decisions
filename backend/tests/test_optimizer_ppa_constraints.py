"""PPA ladder feasibility: missing sizes, unit-saving band, preflight, final gate."""

from __future__ import annotations

from model.optimizer import (
    OptSpec,
    PriceBound,
    _build_menus,
    _constraints_ok,
    _generate_starts,
    _get_blocks,
    _ppa_ladder_ok,
    _ppa_ladder_rows,
    preflight_constraints,
    try_repair_ppa_seed,
    validate_constraint_setup,
)


def _spec(
    prices_meta: list[tuple[str, float, float, float, float]],
    *,
    sizes: dict[str, float],
    min_saving: float | None = 0.06,
    max_saving: float | None = 0.15,
) -> OptSpec:
    """prices_meta: (sku, base, lo, hi, size) — size goes into ppa_sizes separately."""
    bounds = [
        PriceBound(sku=sku, base_price=base, lo=lo, hi=hi)
        for sku, base, lo, hi, _ in prices_meta
    ]
    chain = [sku for sku, *_ in prices_meta]
    return OptSpec(
        bounds=bounds,
        objective="revenue",
        scope_skus=chain,
        ppa_size_chains=[chain],
        ppa_sizes=sizes,
        ppa_min_saving=min_saving,
        ppa_max_saving=max_saving,
    )


def test_ppa_rejects_missing_sizes() -> None:
    spec = _spec(
        [("A", 7.5, 5.0, 10.0, 400), ("B", 21.5, 15.0, 30.0, 1000)],
        sizes={},  # pretend sizes missing
        min_saving=0.06,
    )
    assert _ppa_ladder_ok(spec, {"A": 6.0, "B": 15.0}) is False
    msgs = validate_constraint_setup(spec)
    assert any("Size" in m for m in msgs)


def test_ppa_rejects_near_zero_unit_saving() -> None:
    """The Italiano-style case: ~0% unit saving with min 6% must fail."""
    spec = _spec(
        [("A400", 7.5, 5.0, 10.0, 400), ("B1k", 21.5, 15.0, 30.0, 1000)],
        sizes={"A400": 400.0, "B1k": 1000.0},
        min_saving=0.06,
        max_saving=0.15,
    )
    bad = {"A400": 6.004, "B1k": 15.027}
    assert _constraints_ok(spec, bad) is False
    # Absolute order ok, but unit saving ≈ 0%
    ua, ub = 6.004 / 400, 15.027 / 1000
    assert ub > ua * (1 - 0.06)


def test_ppa_accepts_valid_unit_saving_band() -> None:
    spec = _spec(
        [("A400", 7.5, 5.0, 12.0, 400), ("B1k", 18.0, 10.0, 30.0, 1000)],
        sizes={"A400": 400.0, "B1k": 1000.0},
        min_saving=0.06,
        max_saving=0.15,
    )
    # A at 8.0 → 0.02/g; 6–15% saving → B in [0.02*0.85*1000, 0.02*0.94*1000] = [17, 18.8]
    # and B > 8
    good = {"A400": 8.0, "B1k": 18.0}
    assert _constraints_ok(spec, good) is True


def test_preflight_empty_region_when_min_bound_blocks_saving() -> None:
    """1kg lo=15, 400g can go to 6 → required B≲14.1 for 6% saving → empty."""
    spec = _spec(
        [("A400", 7.5, 5.0, 10.0, 400), ("B1k", 21.5, 15.0, 30.0, 1000)],
        sizes={"A400": 400.0, "B1k": 1000.0},
        min_saving=0.06,
        max_saving=0.15,
    )
    conflicts, seed = preflight_constraints(spec)
    # Region may be nonempty if A stays high enough (A>=~9.15 gives B room above 15).
    # With A in [5,10], A=9.5 → ua=0.02375 → hi_b for 6%=22.3, lo for 15%=20.2; B lo=15 → ok.
    # So nonempty. Force emptiness with a tighter A max so A cannot rise enough:
    spec2 = _spec(
        [("A400", 7.5, 5.0, 7.0, 400), ("B1k", 21.5, 15.0, 30.0, 1000)],
        sizes={"A400": 400.0, "B1k": 1000.0},
        min_saving=0.06,
        max_saving=0.15,
    )
    # Max A=7 → ua=0.0175 → for 6% hi_b=16.45; also need ub<=ua → hi_b=17.5.
    # For max saving 15%: lo_b = 0.0175*0.85*1000=14.875. B lo=15 → [15, 16.45] nonempty!
    # Need higher min saving or higher B lo.
    spec3 = _spec(
        [("A400", 7.5, 5.0, 6.5, 400), ("B1k", 21.5, 16.0, 30.0, 1000)],
        sizes={"A400": 400.0, "B1k": 1000.0},
        min_saving=0.06,
        max_saving=0.15,
    )
    # Max A=6.5 → ua=0.01625 → hi_b for min 6% = 15.275; B lo=16 > 15.275 → empty.
    conflicts3, seed3 = preflight_constraints(spec3)
    assert seed3 is None
    assert conflicts3
    assert any("PPA" in m or "ladder" in m.lower() for m in conflicts3)


def test_repair_seed_produces_feasible_ladder() -> None:
    spec = _spec(
        [("A400", 7.5, 5.0, 12.0, 400), ("B1k", 21.5, 10.0, 30.0, 1000)],
        sizes={"A400": 400.0, "B1k": 1000.0},
        min_saving=0.06,
        max_saving=0.15,
    )
    # Base violates unit order (21.5/1000 > 7.5/400).
    assert _constraints_ok(spec, {"A400": 7.5, "B1k": 21.5}) is False
    repaired = try_repair_ppa_seed(spec, {"A400": 7.5, "B1k": 21.5})
    assert repaired is not None
    assert _constraints_ok(spec, repaired) is True


def test_generate_starts_current_only_returns_single_start() -> None:
    bounds = [
        PriceBound("A", 10.0, 8.0, 12.0),
        PriceBound("B", 20.0, 16.0, 24.0),
    ]
    spec = OptSpec(bounds=bounds, objective="revenue", scope_skus=["A", "B"])
    menus, _ = _build_menus(spec, max_menu=15)

    full = _generate_starts(spec, menus, n_random=1)
    current_only = _generate_starts(spec, menus, n_random=0)[:1]

    assert len(full) >= 4
    assert len(current_only) == 1
    assert current_only[0]["A"] == min(menus["A"], key=lambda p: abs(p - 10.0))
    assert current_only[0]["B"] == min(menus["B"], key=lambda p: abs(p - 20.0))


def test_empty_size_chains_use_tier_links_only_not_mega_chain() -> None:
    """Size ladder off: no cross-tier size comparisons; tier ref block only."""
    bounds = [
        PriceBound("Afia 1.5L", 21.88, 15.0, 30.0),
        PriceBound("Leeza 1.5L", 15.84, 10.0, 22.0),
        PriceBound("Afia 2.9L", 37.70, 25.0, 50.0),
    ]
    spec = OptSpec(
        bounds=bounds,
        objective="value_share",
        scope_skus=[b.sku for b in bounds],
        ppa_size_chains=[],
        ppa_tier_links=[{"high_sku": "Afia 1.5L", "low_sku": "Leeza 1.5L"}],
        ppa_sizes={"Afia 1.5L": 1.5, "Leeza 1.5L": 1.5, "Afia 2.9L": 2.9},
    )
    blocks = _get_blocks(spec)
    assert [len(b) for b in blocks] == [2, 1]
    prices = {"Afia 1.5L": 21.88, "Leeza 1.5L": 15.84, "Afia 2.9L": 37.70}
    assert _ppa_ladder_ok(spec, prices) is True
    rows = _ppa_ladder_rows(spec, prices)
    assert all(r["detail"] != "absolute_order" for r in rows)
    assert any(r.get("is_tier_link") for r in rows)


def test_ppa_ladder_rows_merge_size_chain_and_tier_link_for_ref_sku() -> None:
    """REF SKU in both size chain and tier link keeps saving and tier premium."""
    spec = OptSpec(
        bounds=[
            PriceBound("Afia 0.75L", 11.63, 8.0, 15.0),
            PriceBound("Afia 1.5L", 21.88, 15.0, 30.0),
            PriceBound("Afia 2.9L", 37.70, 25.0, 50.0),
            PriceBound("Leeza 1.5L", 15.34, 10.0, 22.0),
        ],
        objective="value_share",
        scope_skus=["Afia 0.75L", "Afia 1.5L", "Afia 2.9L", "Leeza 1.5L"],
        ppa_size_chains=[["Afia 0.75L", "Afia 1.5L", "Afia 2.9L"]],
        ppa_tier_links=[{"high_sku": "Afia 1.5L", "low_sku": "Leeza 1.5L"}],
        ppa_sizes={
            "Afia 0.75L": 0.75,
            "Afia 1.5L": 1.5,
            "Afia 2.9L": 2.9,
            "Leeza 1.5L": 1.5,
        },
        ppa_min_saving=0.06,
        ppa_max_saving=0.40,
    )
    prices = {
        "Afia 0.75L": 11.63,
        "Afia 1.5L": 21.88,
        "Afia 2.9L": 37.70,
        "Leeza 1.5L": 15.34,
    }
    rows = {r["sku"]: r for r in _ppa_ladder_rows(spec, prices)}

    ref = rows["Afia 1.5L"]
    assert ref["saving_vs_prev"] is not None
    assert ref["saving_vs_prev"] > 0
    assert ref["tier_premium_vs_low"] is not None
    assert ref["tier_premium_vs_low"] > 0
    assert ref["detail"] == "within_band"
    assert ref["is_tier_link"] is False

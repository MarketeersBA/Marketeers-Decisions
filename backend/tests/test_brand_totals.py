"""Unit tests for optimizer brand_totals CM aggregation."""

from __future__ import annotations

import pandas as pd

from api.routes.optimizer import _build_brand_totals


def test_build_brand_totals_unit_cost_cm_delta() -> None:
    base_df = pd.DataFrame(
        [
            {"Product Name": "A", "Revenue": 100.0, "New Price": 10.0, "N.Share": 5.0, "Value Share": 20.0},
            {"Product Name": "B", "Revenue": 100.0, "New Price": 20.0, "N.Share": 5.0, "Value Share": 20.0},
        ]
    )
    final_df = pd.DataFrame(
        [
            {"Product Name": "A", "Revenue": 90.0, "New Price": 11.0, "N.Share": 4.5, "Value Share": 18.0},
            {"Product Name": "B", "Revenue": 120.0, "New Price": 22.0, "N.Share": 6.0, "Value Share": 22.0},
        ]
    )
    costs = {"A": 6.0, "B": 10.0}
    # Base CM: A (10-6)/10=40%, B (20-10)/20=50% → weighted (40+50)/2 = 45%
    # New CM: A (11-6)/11≈45.45%, B (22-10)/22≈54.55% → weighted on 90+120 rev
    out = _build_brand_totals(base_df, final_df, ["A", "B"], costs)
    assert out["base_cm_pct"] == 45.0
    expected_new = (90.0 * (11.0 - 6.0) / 11.0 + 120.0 * (22.0 - 10.0) / 22.0) / 210.0 * 100.0
    assert out["new_cm_pct"] == expected_new
    assert out["cm_delta_pp"] == expected_new - 45.0


def test_build_brand_totals_omits_cm_without_revenue() -> None:
    base_df = pd.DataFrame([{"Product Name": "A", "Revenue": 0.0, "New Price": 10.0}])
    final_df = pd.DataFrame([{"Product Name": "A", "Revenue": 0.0, "New Price": 10.0}])
    out = _build_brand_totals(base_df, final_df, ["A"], {"A": 5.0})
    assert "cm_delta_pp" not in out

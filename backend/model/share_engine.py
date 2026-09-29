"""Share calculation engine (ports findPredictedShares)."""

from __future__ import annotations

import pandas as pd

from model import metrics
from model.preference_engine import compute_preference_shares
from model.share_calculator import calculate_new_shares
from model.study_model import StudyModel


class ShareEngine:
    def find_predicted_shares(self, model: StudyModel) -> dict[str, float]:
        self._run_pipeline(model)
        return {p.name: p.new_share for p in model.included_products()}

    def _run_pipeline(self, model: StudyModel) -> None:
        model._apply_segmentation_filter()

        for p in model.products:
            p.current_share = p.base_share
            p.current_preference_share = p.base_preference_share

        base_pref = compute_preference_shares(
            model, use_new_attributes=False, inclusion=model.base_inclusion()
        )
        for p in model.products:
            if p.base_preference_share == 0.0:
                p.base_preference_share = base_pref.get(p.name, 0.0)
            p.current_preference_share = p.base_preference_share

        new_pref = compute_preference_shares(model, use_new_attributes=True)
        for p in model.products:
            p.new_preference_share = new_pref.get(p.name, 0.0)

        calculate_new_shares(model)
        metrics.apply_scenario_metrics(model)

    def to_results_dataframe(self, model: StudyModel) -> pd.DataFrame:
        metrics.apply_base_metrics(model)
        self._run_pipeline(model)
        rows: list[dict] = []

        for product in model.products:
            m = metrics.product_metrics_row(model, product)
            row: dict = {
                "Product Index": product.product_id,
                "Product Name": product.name,
                "Selected": product.included,
                "B.Share": m["B.Share"],
                "N.Share": m["N.Share"],
                "S.Index": m["S.Index"],
                "Preference Share": m["Preference Share"],
                "Value Share": m["Value Share"],
                "Revenue": m["Revenue"],
                "R.Index": m["R.Index"],
                "Penetration": m["Penetration"],
                "Audit Share": m["Audit Share"],
                "VSU": m["VSU"],
                "Base WD": product.base_wd,
                "New WD": product.new_wd,
            }
            for attr in model.conditional_attrs:
                row[f"Base {attr}"] = product.base_attributes.get(attr, 0)
                row[f"New {attr}"] = product.new_attributes.get(
                    attr, product.base_attributes.get(attr, 0)
                )
            for attr in model.discrete_attrs:
                if attr.upper() == "SKU":
                    continue
                row[attr] = product.discrete_levels.get(attr, 1)
            if model.financial:
                from model.financial import apply_financial
                apply_financial(product, True)
                row["NOS"] = product.nos
                row["TDC"] = product.tdc
                row["MM$"] = product.revenue - product.nos - product.tdc
            rows.append(row)
        return pd.DataFrame(rows)

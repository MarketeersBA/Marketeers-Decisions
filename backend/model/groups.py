"""Group-level metric rollups."""

from __future__ import annotations

from model.study_model import StudyModel


def group_summary(model: StudyModel, product_shares: dict[str, float]) -> list[dict]:
    """Legacy N.Share-only rollup (share values as fractions 0–1)."""
    rows: list[dict] = []
    for group in model.doc.groups:
        members = [n for n in group.product_names if n in product_shares]
        if not members:
            continue
        total = sum(product_shares.get(m, 0) for m in members)
        rows.append({"Name": group.group_name, "N.Share": total * 100, "GroupType": group.group_type})
    return rows


def group_metric_rows(model: StudyModel, group_type: str = "Brand") -> list[dict]:
    """Full group metrics for Compare / Groups panel (REQ-MET-01).

    Shares are in the same units as the results grid (% points, not fractions).
    Includes productNames for UI membership (no name-prefix guessing).
    """
    rows: list[dict] = []
    for group in model.doc.groups:
        if group.group_type != group_type:
            continue
        products = []
        member_names: list[str] = []
        for name in group.product_names:
            p = model.get_product(name)
            if p is not None:
                products.append(p)
                member_names.append(name)
        if not products:
            continue
        included = [p for p in products if p.included]
        n_share = sum(p.new_share for p in included)
        b_share = sum(p.base_share for p in products)
        revenue = sum(p.revenue for p in included)
        # Legacy getGroupBaseRevenue: BaseIncluded (base lineup), not current Included.
        # Keeps R.Index aligned with S.Index when SKUs are excluded (num shrinks, denom holds).
        base_flags = {
            s.name: s.included
            for s in getattr(model, "_base_snapshot", None) or []
        }

        def _in_base_lineup(p) -> bool:
            if p.name in base_flags:
                return bool(base_flags[p.name])
            return p.base_share > 0

        base_rev = sum(p.base_revenue for p in products if _in_base_lineup(p))
        row: dict = {
            "Name": group.group_name,
            "GroupType": group.group_type,
            "productNames": member_names,
            "N.Share": n_share,
            "B.Share": b_share,
            "S.Index": n_share / b_share if b_share else 0.0,
            "Audit Share": sum(p.audit_share for p in products),
            "Preference Share": sum(p.new_preference_share for p in included),
            "Penetration": sum(p.penetration for p in included),
            "Value Share": sum(p.value_share for p in included),
            "Revenue": revenue,
            "R.Index": revenue / base_rev if base_rev else 1.0,
        }
        if model.financial:
            row["MM$"] = sum(p.revenue - p.nos - p.tdc for p in included)
        rows.append(row)
    rows.sort(key=lambda r: float(r.get("B.Share") or 0.0), reverse=True)
    return rows

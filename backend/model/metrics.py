"""Derived metrics (ports setProductsRevenue, setProductsValueShare, setProductsPenetration)."""

from __future__ import annotations

from model.study_model import ProductState, StudyModel


def _price(product: ProductState, model: StudyModel, *, use_new: bool) -> float:
    idx = model.price_attribute_index
    if idx >= 0:
        return product.get_attribute(idx, use_new=use_new)
    return float(product.new_attributes.get("Price", product.base_attributes.get("Price", 1.0)) or 1.0)


def _size_attr_name(model: StudyModel) -> str:
    doc = getattr(model, "doc", None)
    if doc is not None:
        return getattr(doc.meta, "size_attribute", None) or "Size"
    return "Size"


def pack_size(product: ProductState, model: StudyModel, *, use_new: bool) -> float:
    """Pack size for financial formulas: base or scenario, matching price accessors.

    Prefer the configured size attribute (scenario vs base). Fall back to the
    frozen ``product.size_unit`` from study init when the attribute is missing.
    """
    idx = getattr(model, "size_attribute_index", -1)
    if idx >= 0:
        try:
            sz = float(product.get_attribute(idx, use_new=use_new))
        except (TypeError, ValueError):
            sz = 0.0
        if sz:
            return sz

    size_key = _size_attr_name(model)
    if use_new:
        raw = product.new_attributes.get(
            size_key, product.base_attributes.get(size_key)
        )
    else:
        raw = product.base_attributes.get(size_key)
    try:
        if raw is not None:
            sz = float(raw)
            if sz:
                return sz
    except (TypeError, ValueError):
        pass

    return product.size_unit if product.size_unit else 1.0


def apply_base_metrics(model: StudyModel) -> None:
    """Compute base preference share, base revenue, base penetration."""
    from model.preference_engine import compute_preference_shares

    base_pref = compute_preference_shares(
        model, use_new_attributes=False, inclusion=model.base_inclusion()
    )
    msu, su = model.msu, model.su

    for p in model.products:
        p.base_preference_share = base_pref.get(p.name, 0.0)
        p.current_preference_share = p.base_preference_share
        price = _price(p, model, use_new=False)
        sz = pack_size(p, model, use_new=False)
        if p.included or p.base_share > 0:
            p.base_revenue = msu * su * p.base_share * price / (sz * 100.0)
            p.base_value_sales_unit = msu * p.base_share * price / (100.0 * sz)

    _set_base_penetration(model)
    _set_base_value_share(model)


def apply_scenario_metrics(model: StudyModel) -> None:
    """Compute revenue, value share, penetration after share calculation."""
    msu, su = model.msu, model.su

    for p in model.included_products():
        price = _price(p, model, use_new=True)
        sz = pack_size(p, model, use_new=True)
        p.revenue = msu * su * p.new_share * price / (sz * 100.0)
        p.value_sales_unit = msu * p.new_share * price / (100.0 * sz)

    total_vsu = sum(p.value_sales_unit for p in model.included_products())
    total_base_rev = sum(p.base_revenue for p in model.products if p.included or p.base_share > 0)
    vsu_anchor = model.vsu if model.vsu else total_vsu
    value_share_unit = total_vsu + vsu_anchor - total_base_rev
    if value_share_unit <= 0:
        value_share_unit = total_vsu if total_vsu > 0 else 1.0

    for p in model.included_products():
        p.value_share = p.value_sales_unit / value_share_unit * 100.0

    for p in model.products:
        if not p.included:
            p.revenue = 0.0
            p.value_sales_unit = 0.0
            p.value_share = 0.0
            p.penetration = 0.0

    _set_penetration(model)


def _set_penetration(model: StudyModel) -> None:
    pref_wd_sum = 0.0
    share_sum = 0.0
    for p in model.included_products():
        pref_wd_sum += p.new_preference_share * p.new_wd
        share_sum += p.new_share
    scale = share_sum / pref_wd_sum if pref_wd_sum > 0 else 0.0
    for p in model.included_products():
        p.penetration = p.new_preference_share * p.new_wd * scale


def _set_base_penetration(model: StudyModel) -> None:
    pref_wd_sum = 0.0
    share_sum = 0.0
    for p in model.included_products():
        pref_wd_sum += p.base_preference_share * p.base_wd
        share_sum += p.base_share
    scale = share_sum / pref_wd_sum if pref_wd_sum > 0 else 0.0
    for p in model.included_products():
        p.penetration = p.base_preference_share * p.base_wd * scale


def _set_base_value_share(model: StudyModel) -> None:
    total_base_vsu = sum(p.base_value_sales_unit for p in model.included_products())
    total_base_rev = sum(p.base_revenue for p in model.products if p.included or p.base_share > 0)
    vsu_anchor = model.vsu if model.vsu else total_base_vsu
    denom = total_base_vsu + vsu_anchor - total_base_rev
    if denom <= 0:
        denom = total_base_vsu if total_base_vsu > 0 else 1.0
    for p in model.included_products():
        p.base_value_share = p.base_value_sales_unit / denom * 100.0


def product_metrics_row(model: StudyModel, product: ProductState) -> dict[str, float]:
    if not product.included:
        return {
            "B.Share": product.base_share,
            "N.Share": 0.0,
            "S.Index": 0.0,
            "Preference Share": 0.0,
            "Value Share": 0.0,
            "Revenue": 0.0,
            "R.Index": 0.0,
            "Penetration": 0.0,
            "Audit Share": product.audit_share,
            "VSU": 0.0,
        }
    base_rev = product.base_revenue if product.base_revenue else 0.0
    return {
        "B.Share": product.base_share,
        "N.Share": product.new_share,
        "S.Index": product.new_share / product.base_share if product.base_share else 0.0,
        "Preference Share": product.new_preference_share,
        "Value Share": product.value_share,
        "Revenue": product.revenue,
        "R.Index": product.revenue / base_rev if base_rev else 1.0,
        "Penetration": product.penetration,
        "Audit Share": product.audit_share,
        "VSU": product.value_sales_unit,
    }

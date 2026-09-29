"""Market share from preference shares (ports Products.calculateNewShare / rebaseNewShare)."""

from __future__ import annotations

from model.study_model import ProductState, StudyModel


def _size_ratio(product: ProductState, size_attr_index: int) -> float:
    if size_attr_index < 0:
        return 1.0
    new_sz = product.get_attribute(size_attr_index, use_new=True)
    base_sz = product.get_attribute(size_attr_index, use_new=False)
    if base_sz == 0:
        return 1.0
    return new_sz / base_sz


def calculate_new_shares(model: StudyModel) -> None:
    """Update product new_share / new_preference_share in place."""
    products = model.products
    size_idx = model.size_attribute_index

    total_pref = 0.0
    for p in products:
        if not p.included:
            continue
        wd_ratio = 1.0 if p.product_type == "NewProduct" else (
            p.new_wd / p.base_wd if p.base_wd else 0.0
        )
        if p.product_type == "NewProduct":
            p.new_preference_share *= _size_ratio(p, size_idx)
        else:
            p.new_preference_share *= wd_ratio * _size_ratio(p, size_idx)
        total_pref += p.new_preference_share

    if total_pref > 0:
        for p in products:
            if p.included:
                p.new_preference_share = p.new_preference_share / total_pref * 100.0

    for p in products:
        if not p.included:
            continue
        if p.product_type == "ReplacedProduct" and p.base_product_id > 0:
            base = model.product_by_id(p.base_product_id)
            if base and base.current_preference_share > 0:
                p.new_share = (
                    base.current_share
                    * p.new_preference_share
                    / base.current_preference_share
                )
            else:
                p.new_share = 0.0
        elif p.product_type == "NewProduct":
            p.new_share = (
                p.new_preference_share
                * p.new_wd
                * p.consumption_calibration
                * p.sor
                * p.awareness_level
                * p.repeat_rate
                / 100.0
            )
        else:
            if p.current_preference_share > 0:
                p.new_share = p.current_share * (
                    p.new_preference_share / p.current_preference_share
                )
            else:
                p.new_share = 0.0
        p.new_share *= p.promotion_calibration

    _rebase_new_share(model)


def _rebase_new_share(model: StudyModel) -> None:
    products = model.products
    total_current = sum(p.current_share for p in products)
    pos_sum = 0.0
    neg_sum = 0.0
    total_new = 0.0

    for p in products:
        if p.included:
            if p.product_type == "ReplacedProduct" and p.base_product_id > 0:
                base = model.product_by_id(p.base_product_id)
                base_share = base.current_share if base else 0.0
                p.diff_volume_share = p.new_share - base_share
                neg_sum += base_share
            else:
                p.diff_volume_share = p.new_share - p.current_share
            total_new += p.new_share
            if p.diff_volume_share > 0:
                pos_sum += p.diff_volume_share
            elif p.diff_volume_share < 0:
                neg_sum += p.diff_volume_share
        elif p.current_share > 0:
            neg_sum -= p.current_share

    delta = total_new - total_current
    total_new = 0.0

    for p in products:
        if not p.included:
            continue
        if delta > 0 and p.diff_volume_share > 0 and pos_sum != 0:
            p.diff_volume_share *= abs(neg_sum / pos_sum)
            if p.product_type == "ReplacedProduct" and p.base_product_id > 0:
                base = model.product_by_id(p.base_product_id)
                p.new_share = (base.current_share if base else 0.0) + p.diff_volume_share
            else:
                p.new_share = p.current_share + p.diff_volume_share
        elif delta < 0 and p.diff_volume_share < 0 and neg_sum != 0:
            p.diff_volume_share *= abs(pos_sum / neg_sum)
            if p.product_type == "ReplacedProduct" and p.base_product_id > 0:
                base = model.product_by_id(p.base_product_id)
                p.new_share = (base.current_share if base else 0.0) + p.diff_volume_share
            else:
                p.new_share = p.current_share + p.diff_volume_share
        total_new += p.new_share

    if total_new > 0 and total_current > 0:
        scale = total_current / total_new
        for p in products:
            if p.included:
                p.new_share *= scale

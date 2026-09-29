"""Financial metrics (NOS/TDC)."""

from __future__ import annotations

from model.study_model import ProductState


def apply_financial(product: ProductState, enabled: bool) -> None:
    if not enabled:
        product.nos = 0.0
        product.tdc = 0.0
        return
    
    product.nos = product.new_nos if product.new_nos is not None else 0.0
    product.tdc = product.new_tdc if product.new_tdc is not None else 0.0

"""Price index vs share/revenue — ported from priceIndexAndRevenues."""

from __future__ import annotations

from typing import TYPE_CHECKING

from model.metrics import pack_size

if TYPE_CHECKING:
    from model.project_core import ProjectCore


def price_index_and_revenues(
    project: "ProjectCore",
    product_name: str,
    reference_product_name: str,
    scale: list[str] | None = None,
) -> dict:
    model = project._model
    if model is None:
        return {"columns": [], "rows": []}

    if scale is None:
        scale = ["0.8", "0.9", "1.0", "1.1", "1.2"]

    ref = model.get_product(reference_product_name)
    target = model.get_product(product_name)
    if ref is None or target is None:
        return {"columns": scale, "rows": []}

    ref_price = float(
        ref.new_attributes.get("Price", ref.base_attributes.get("Price", 1.0)) or 1.0
    )
    ref_size = pack_size(ref, model, use_new=True)
    ref_unit = ref_price / ref_size if ref_size else ref_price
    target_size = pack_size(target, model, use_new=True)

    saved_price = float(
        target.new_attributes.get("Price", target.base_attributes.get("Price", 1.0)) or 1.0
    )

    included_names = [p.name for p in model.included_products()]
    rows: list[dict] = [
        {"name": n, "values": {}} for n in included_names
    ]
    rows.append({"name": f"{model.company_name} Shares", "values": {}})
    rows.append({"name": f"{model.company_name} Revenues", "values": {}})

    for col in scale:
        multiplier = float(col)
        new_price = ref_unit * multiplier * target_size
        project.change_product_attribute(product_name, "Price", str(new_price))
        project.find_predicted_shares()

        for row in rows[:-2]:
            row["values"][col] = project.get_product_share("NewShare", row["name"]) / 100.0
        rows[-2]["values"][col] = project.get_company_share("NewShare") / 100.0
        rows[-1]["values"][col] = project.get_company_revenue()

    project.change_product_attribute(product_name, "Price", str(saved_price))
    project.find_predicted_shares()
    return {"columns": scale, "rows": rows, "productName": product_name, "referenceProduct": reference_product_name}

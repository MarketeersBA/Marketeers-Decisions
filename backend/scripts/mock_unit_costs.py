"""Generate mock unit_costs.csv for a study (base price × stable random ratio per SKU)."""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from api.deps import resolve_client_id
from config import MOCK_UNIT_COST_RATIO_HI, MOCK_UNIT_COST_RATIO_LO, ensure_directories, get_storage, study_folder
from data.unit_costs import mock_cost_ratio, mock_unit_cost
from model.project_core import ProjectCore


def _base_price(project: ProjectCore, sku: str) -> float:
    row = project.results[project.results["Product Name"] == sku]
    if row.empty:
        prod = project._model.get_product(sku) if project._model else None
        raw = prod.base_attributes.get("Price", 0.0) if prod else 0.0
    else:
        raw = row.iloc[0].get("Base Price", row.iloc[0].get("Price", 0.0))
    try:
        return float(raw or 0.0)
    except (TypeError, ValueError):
        return 0.0


def generate_unit_costs(slug: str, *, skus: list[str] | None = None) -> list[dict[str, float | str]]:
    if not ProjectCore.study_exists(slug):
        raise FileNotFoundError(f"Study not found: {slug}")

    project = ProjectCore(slug)
    project.initialize()
    project.reset_products()
    if project.results is None or project.results.empty:
        project.reload_results()

    names = skus if skus is not None else list(project.all_products)
    rows: list[dict[str, float | str]] = []
    for sku in names:
        base = _base_price(project, sku)
        cost = mock_unit_cost(base, slug, sku)
        rows.append({
            "SKU": sku,
            "Unit Cost": cost,
            "Base Price": round(base, 3),
            "Cost Ratio": round(mock_cost_ratio(slug, sku), 4),
        })
    return rows


def write_unit_costs_csv(slug: str, rows: list[dict[str, float | str]]) -> Path:
    cid = resolve_client_id()
    path = study_folder(slug, cid) / "unit_costs.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["SKU", "Unit Cost"])
        writer.writeheader()
        for row in rows:
            writer.writerow({"SKU": row["SKU"], "Unit Cost": row["Unit Cost"]})
    get_storage().put_study_file(cid, slug, "unit_costs.csv")
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description="Write mock unit_costs.csv for a study")
    parser.add_argument("--slug", default="ELARABY_PTV_2021", help="Study folder slug")
    parser.add_argument(
        "--company-only",
        action="store_true",
        help="Only company SKUs (default: all products)",
    )
    args = parser.parse_args()

    ensure_directories()
    project = ProjectCore(args.slug)
    project.initialize()
    project.reset_products()
    skus = list(project.company_products) if args.company_only else None
    rows = generate_unit_costs(args.slug, skus=skus)
    path = write_unit_costs_csv(args.slug, rows)

    priced = [r for r in rows if float(r["Base Price"]) > 0]
    print(f"Study: {args.slug}")
    print(f"Ratio range: {MOCK_UNIT_COST_RATIO_LO:.0%} – {MOCK_UNIT_COST_RATIO_HI:.0%} of base price")
    print(f"Wrote {len(rows)} SKUs to {path}")
    if priced:
        ratios = [float(r["Cost Ratio"]) for r in priced]
        print(
            f"Sample (first 5 with base price > 0): "
            + ", ".join(
                f"{r['SKU'][:30]}={float(r['Cost Ratio']):.1%}"
                for r in priced[:5]
            )
        )
        print(f"Actual ratio range across priced SKUs: {min(ratios):.1%} – {max(ratios):.1%}")


if __name__ == "__main__":
    main()

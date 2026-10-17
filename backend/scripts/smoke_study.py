"""Smoke test for folder-per-study Python engine."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

# Allow running as python -m scripts.smoke_study from market_simulator/
_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from config import ensure_directories
from data.study_writer import write_study
from model.project_core import ProjectCore, ProjectRegistry
from model.study_schema import AttributeDef, ConditionalLevelRow, ProductDef, StudyDocument, StudyMeta


def _create_demo_study() -> str:
    doc = StudyDocument(
        meta=StudyMeta(
            study_name="Demo Study",
            company_name="Demo Co",
            company_location="Egypt",
            msu=1.0,
            exponent_factor=1.0,
            products_count=3,
            respondents_count=100,
        ),
        attributes=[
            AttributeDef(name="SKU", attr_type="Discrete", is_sku=True, level_count=3),
            AttributeDef(name="Price", attr_type="Conditional", level_count=2),
        ],
        products=[
            ProductDef(1, "Product A", "Company", True, 40.0, 1.0, base_attributes={"Price": 10.0}),
            ProductDef(2, "Product B", "Company", True, 35.0, 1.0, base_attributes={"Price": 12.0}),
            ProductDef(3, "Product C", "", True, 25.0, 1.0, base_attributes={"Price": 8.0}),
        ],
        conditional_levels=[
            ConditionalLevelRow(1, "Product A", {"Level 1": 10.0, "Level 2": 12.0}, "Price"),
            ConditionalLevelRow(2, "Product B", {"Level 1": 12.0, "Level 2": 14.0}, "Price"),
            ConditionalLevelRow(3, "Product C", {"Level 1": 8.0, "Level 2": 10.0}, "Price"),
        ],
    )
    rng = np.random.default_rng(42)
    rows = []
    for i in range(100):
        row = {"RespondentID": i + 1, "RespondentWeight": 1.0}
        row["ProductID1"] = rng.normal(0.5, 0.1)
        row["ProductID2"] = rng.normal(0.4, 0.1)
        row["ProductID3"] = rng.normal(0.3, 0.1)
        row["PriceLevel1"] = rng.normal(0.0, 0.05)
        row["PriceLevel2"] = rng.normal(-0.02, 0.05)
        rows.append(row)
    hbu = pd.DataFrame(rows)
    return write_study(doc, hbu)


def run_smoke(slug: str | None = None) -> None:
    ensure_directories()
    if slug is None:
        slug = _create_demo_study()
        print(f"Created demo study: {slug}")
    elif not ProjectCore.study_exists(slug):
        print(f"Study not found: {slug}")
        sys.exit(1)

    registry = ProjectRegistry.instance()
    registry.clear()
    registry.initialize_projects(slug)
    project = registry.get("MainStudy")
    print(f"Loaded: {project.study_name} ({len(project.all_products)} products)")

    df = project.results
    total_share = df[df["Selected"]]["N.Share"].sum()
    print(f"Base total N.Share (included): {total_share:.2f}%")

    if project.all_products:
        project.change_product_attribute(project.all_products[0], "Price", "5%")
        project.reload_results()
        new_total = project.results[project.results["Selected"]]["N.Share"].sum()
        print(f"After +5% price on {project.all_products[0]}: total N.Share = {new_total:.2f}%")

    if abs(total_share - 100.0) > 5.0 and total_share > 0:
        print("WARNING: shares do not sum to ~100% — review share_engine")
    else:
        print("OK: smoke test passed")


def main() -> None:
    parser = argparse.ArgumentParser(description="Smoke test market simulator")
    parser.add_argument("--slug", help="Existing study slug (default: create demo)")
    args = parser.parse_args()
    run_smoke(args.slug)


if __name__ == "__main__":
    main()

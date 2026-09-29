"""Test import of ELARABY design + HBU and creation of Base scenario."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from config import ensure_directories, study_folder
from data.excel_importer import import_design_sheet, import_hbu_sheet
from data.scenario_store import ScenarioStore
from data.study_writer import write_study
from model.project_core import ProjectCore, ProjectRegistry

DEFAULT_DESIGN = r"D:\Simulator\araby\Design-Sheet-PTV-2021-Promotions.xlsx"
DEFAULT_HBU = r"D:\Simulator\araby\HBU-29-9-1.xlsx"


def run(design_path: str, hbu_path: str, scenario_name: str = "Base") -> None:
    ensure_directories()

    print("=== 1. Import design sheet ===")
    doc = import_design_sheet(design_path)
    print(f"  Study: {doc.meta.study_name!r}")
    print(f"  Company: {doc.meta.company_name!r}")
    print(f"  MSU: {doc.meta.msu}, SU: {doc.meta.su}")
    print(f"  Products: {len(doc.products)}")
    print(f"  Attributes: {[a.name for a in doc.attributes]}")
    print(f"  Conditional level rows: {len(doc.conditional_levels)}")
    print(f"  Segments: {len(doc.segments)}")
    print(f"  Respondent segmentation rows: {len(doc.respondent_segmentation)}")

    print("\n=== 2. Import HBU ===")
    hbu = import_hbu_sheet(hbu_path, doc)
    print(f"  Respondents: {len(hbu)}")
    print(f"  HBU columns: {len(hbu.columns)}")
    print(f"  Sample columns: {list(hbu.columns[:10])}")

    print("\n=== 3. Write study ===")
    slug = write_study(doc, hbu)
    print(f"  Slug: {slug}")
    print(f"  Folder: {study_folder(slug)}")

    print("\n=== 4. Load and run base simulation ===")
    registry = ProjectRegistry.instance()
    registry.clear()
    registry.initialize_projects(slug)
    main = registry.get("MainStudy")
    base = registry.get("BaseScenario")
    print(f"  Loaded: {main.study_name}")

    df = main.results
    inc = df[df["Selected"] == True]  # noqa: E712
    print(f"  Included products: {len(inc)}")
    print(f"  Total N.Share (included): {inc['N.Share'].sum():.2f}%")
    print("\n  Top 5 by N.Share:")
    top = inc.nlargest(5, "N.Share")
    for _, row in top.iterrows():
        print(
            f"    {row['Product Name'][:40]:40s}  "
            f"B={row['B.Share']:6.2f}  N={row['N.Share']:6.2f}  "
            f"Pref={row['Preference Share']:6.2f}"
        )

    print(f"\n=== 5. Capture and save '{scenario_name}' scenario ===")
    scenario = main.capture_scenario(
        scenario_name,
        "Initial base scenario from design import",
        validation=False,
    )
    store = ScenarioStore(slug)
    store.save(scenario)
    print(f"  Saved: {store._scenario_path(scenario_name)}")
    print(f"  Products tracked: {len(scenario.included_products)}")
    print(f"  Segmentation: {scenario.segmentation or 'none'}")

    print("\n=== 6. Verify BaseScenario snapshot ===")
    base_inc = base.results[base.results["Selected"] == True]  # noqa: E712
    print(f"  BaseScenario N.Share total: {base_inc['N.Share'].sum():.2f}%")

    reloaded = store.load(scenario_name)
    assert reloaded.name == scenario_name
    print("\n=== OK: study created and Base scenario saved ===")


def main() -> None:
    parser = argparse.ArgumentParser(description="Test ELARABY Excel import + Base scenario")
    parser.add_argument("--design", default=DEFAULT_DESIGN)
    parser.add_argument("--hbu", default=DEFAULT_HBU)
    parser.add_argument("--scenario-name", default="Base")
    args = parser.parse_args()
    run(args.design, args.hbu, args.scenario_name)


if __name__ == "__main__":
    main()

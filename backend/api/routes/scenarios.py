"""Scenario persistence endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile

from api.deps import get_current_client_id
from api.schemas import CompareRequest, ReorderScenariosRequest, SaveScenarioRequest
from api.study_access import require_study
from api.sessions import session_manager
from data.scenario_importer import import_scenarios_from_excel, preview_scenario_import
from data.scenario_store import ScenarioStore
from model.project_core import ProjectCore
from utils.excel_export import export_comparison_to_excel


router = APIRouter(prefix="/api/studies", tags=["scenarios"])


@router.get("/{slug}/scenarios")
def list_scenarios(
    slug: str = Depends(require_study),
    client_id: str = Depends(get_current_client_id),
) -> list[dict]:
    store = ScenarioStore(slug, client_id)
    return store.list_scenarios()


@router.post("/{slug}/scenarios/seed-base")
def seed_base_scenario(
    slug: str = Depends(require_study),
    client_id: str = Depends(get_current_client_id),
) -> dict:
    """Persist a 'Base' scenario from the study's default product state (no session required)."""
    try:
        project = ProjectCore(slug, client_id=client_id)
        project.initialize()
    except Exception as exc:
        raise HTTPException(
            status_code=404, detail=f"Study not found or failed to load: {slug}"
        ) from exc

    store = ScenarioStore(slug, client_id)
    name = "Base"
    if store.exists(name):
        return {"ok": True, "name": name, "created": False}

    project.reset_products()
    scenario = project.capture_scenario(name, "Study base prices and attributes", False)
    store.save(scenario)
    return {"ok": True, "name": name, "created": True}


@router.post("/{slug}/scenarios")
def save_scenario(
    body: SaveScenarioRequest,
    slug: str = Depends(require_study),
    client_id: str = Depends(get_current_client_id),
) -> dict:
    try:
        session_slug = session_manager.get_slug(body.session_id, client_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Session not found or expired") from exc
    if session_slug != slug:
        raise HTTPException(status_code=400, detail="Session does not belong to this study")

    if body.validation:
        raise HTTPException(
            status_code=400,
            detail=(
                "Validation scenarios from the simulator are deprecated. "
                "Upload validation waves on Data Hub (Description + Product List workbook)."
            ),
        )

    project = session_manager.get(body.session_id, client_id)
    scenario = project.capture_scenario(body.name, body.description, False)
    store = ScenarioStore(slug, client_id)
    store.save(scenario)
    return {"ok": True, "name": body.name}


@router.patch("/{slug}/scenarios/order")
def reorder_scenarios(
    body: ReorderScenariosRequest,
    slug: str = Depends(require_study),
    client_id: str = Depends(get_current_client_id),
) -> dict:
    store = ScenarioStore(slug, client_id)
    try:
        ordered = store.reorder(body.order)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "scenarios": ordered}


@router.post("/{slug}/scenarios/import/preview")
async def preview_import(
    slug: str = Depends(require_study),
    file: UploadFile = File(...),
) -> dict:
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Upload an Excel file (.xlsx)")
    content = await file.read()
    previews = preview_scenario_import(content)
    return {"slug": slug, "previews": previews}


@router.post("/{slug}/scenarios/import")
async def import_scenarios(
    slug: str = Depends(require_study),
    file: UploadFile = File(...),
    names: str = Form(""),
    client_id: str = Depends(get_current_client_id),
) -> dict:
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Upload an Excel file (.xlsx)")
    content = await file.read()
    selected = [n.strip() for n in names.split(",") if n.strip()] or None
    scenarios = import_scenarios_from_excel(content, names=selected)
    if not scenarios:
        raise HTTPException(status_code=400, detail="No valid scenario sheets found")
    store = ScenarioStore(slug, client_id)
    count = store.import_many(scenarios)
    return {"ok": True, "imported": count, "names": [s.name for s in scenarios]}


@router.delete("/{slug}/scenarios/{name}")
def delete_scenario(
    name: str,
    slug: str = Depends(require_study),
    client_id: str = Depends(get_current_client_id),
) -> dict:
    store = ScenarioStore(slug, client_id)
    if not store.exists(name):
        raise HTTPException(status_code=404, detail=f"Scenario not found: {name}")
    store.delete(name)
    return {"ok": True}


@router.post("/{slug}/compare")
def compare_scenarios(
    body: CompareRequest,
    slug: str = Depends(require_study),
    client_id: str = Depends(get_current_client_id),
) -> dict:
    from api.serializers import dataframe_to_records, group_rows
    import pandas as pd

    try:
        base_project = ProjectCore(slug, client_id=client_id)
        base_project.initialize()
    except Exception as exc:
        raise HTTPException(
            status_code=404, detail=f"Study not found or failed to load: {slug}"
        ) from exc

    base_project.reset_products()
    base_project.find_predicted_shares()

    scenarios_data = {}
    store = ScenarioStore(slug, client_id)

    for name in body.scenarios:
        if not store.exists(name):
            raise HTTPException(status_code=404, detail=f"Scenario not found: {name}")
        scenario = store.load(name)

        project = ProjectCore(slug, client_id=client_id)
        project.initialize()
        project.apply_scenario(scenario)
        project.find_predicted_shares()

        groups_by_type = {}
        for gt in project.group_types:
            groups_by_type[gt] = group_rows(project, gt)

        scenarios_data[name] = {
            "results": dataframe_to_records(project.results),
            "groups": groups_by_type,
        }

    base_groups_by_type = {}
    for gt in base_project.group_types:
        base_groups_by_type[gt] = group_rows(base_project, gt)

    return {
        "base": {
            "results": dataframe_to_records(base_project.results),
            "groups": base_groups_by_type,
        },
        "scenarios": scenarios_data,
        "groupTypes": base_project.group_types,
    }


@router.post("/{slug}/compare/export")
def export_comparison(
    body: CompareRequest,
    slug: str = Depends(require_study),
    client_id: str = Depends(get_current_client_id),
) -> Response:
    import pandas as pd

    store = ScenarioStore(slug, client_id)
    try:
        base_project = ProjectCore(slug, client_id=client_id)
        base_project.initialize()
    except Exception as exc:
        raise HTTPException(
            status_code=404, detail=f"Study not found or failed to load: {slug}"
        ) from exc

    base_project.reset_products()
    base_project.find_predicted_shares()
    base_df = base_project.results

    volume_rows = []
    value_rows = []
    revenue_rows = []

    for scenario_name in body.scenarios:
        if not store.exists(scenario_name):
            raise HTTPException(status_code=404, detail=f"Scenario not found: {scenario_name}")
        scenario = store.load(scenario_name)

        project = ProjectCore(slug, client_id=client_id)
        project.initialize()
        project.apply_scenario(scenario)
        project.find_predicted_shares()
        df = project.results

        for _, row in df.iterrows():
            product = str(row["Product Name"])
            base_row = base_df[base_df["Product Name"] == product]
            base_share = float(base_row.iloc[0]["N.Share"]) if not base_row.empty else 0.0
            new_share = float(row.get("N.Share", 0))
            base_val = float(base_row.iloc[0].get("Value Share", 0)) if not base_row.empty else 0.0
            new_val = float(row.get("Value Share", 0))
            base_rev = float(base_row.iloc[0].get("Revenue", 0)) if not base_row.empty else 0.0
            new_rev = float(row.get("Revenue", 0))

            volume_rows.append({
                "Product": product,
                "Scenario": scenario_name,
                "Share": new_share,
                "Base": base_share,
                "Index": new_share / base_share if base_share else 0,
            })
            value_rows.append({
                "Product": product,
                "Scenario": scenario_name,
                "Share": new_val,
                "Base": base_val,
                "Index": new_val / base_val if base_val else 0,
            })
            revenue_rows.append({
                "Product": product,
                "Scenario": scenario_name,
                "Revenue": new_rev,
                "Base": base_rev,
                "Index": new_rev / base_rev if base_rev else 0,
            })

    vol_df = pd.DataFrame(volume_rows)
    val_df = pd.DataFrame(value_rows)
    rev_df = pd.DataFrame(revenue_rows)

    excel_bytes = export_comparison_to_excel(
        volume=vol_df,
        value_share=val_df,
        revenue=rev_df,
        study_name=base_project.study_name,
    )

    filename = f"{base_project.study_name}_comparison.xlsx"
    return Response(
        content=excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


"""Validation wave uploads and Runner validation scenario scoring."""

from __future__ import annotations

from io import BytesIO

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from api.deps import get_current_client_id
from api.study_access import require_study
from config import get_storage
from data.validation_importer import ValidationImportError, import_validation_workbook
from data.validation_store import ValidationWaveStore
from model.analytics.validation import validation_scenario_score, validation_series


router = APIRouter(prefix="/api/studies", tags=["validation"])


@router.get("/{slug}/validation")
def list_validation_waves(slug: str = Depends(require_study)) -> dict:
    store = ValidationWaveStore(slug)
    return {"waves": store.list_waves()}


@router.get("/{slug}/validation/series")
def get_validation_series(
    slug: str = Depends(require_study),
    metric: str = Query("company_share", description="company_share (volume)"),
) -> dict:
    return validation_series(slug, metric=metric)


@router.post("/{slug}/validation/upload")
async def upload_validation_wave(
    slug: str = Depends(require_study),
    client_id: str = Depends(get_current_client_id),
    file: UploadFile = File(...),
) -> dict:
    filename = file.filename or ""
    if not filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Please upload an Excel workbook (.xlsx or .xls).",
        )
    content = await file.read()
    doc, _ = get_storage().load_study(client_id, slug)
    store = ValidationWaveStore(slug)
    try:
        wave = import_validation_workbook(
            BytesIO(content),
            doc,
            source_filename=filename,
        )
    except ValidationImportError as exc:
        detail: dict | str = {"message": str(exc)}
        if exc.row_errors:
            detail = {"message": str(exc), "rowErrors": exc.row_errors}
        raise HTTPException(status_code=400, detail=detail) from exc

    if store.name_exists(wave.name):
        raise HTTPException(
            status_code=409,
            detail=f"Validation wave already exists: {wave.name}",
        )
    store.save(wave)
    return {
        "id": wave.id,
        "name": wave.name,
        "validationDate": wave.validation_date,
        "notes": wave.notes,
        "sourceFilename": wave.source_filename,
        "createdAt": wave.created_at,
        "productCount": len(wave.products),
    }


@router.delete("/{slug}/validation/{wave_id}")
def delete_validation_wave(
    wave_id: str,
    slug: str = Depends(require_study),
) -> dict:
    store = ValidationWaveStore(slug)
    try:
        store.load(wave_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    store.delete(wave_id)
    return {"deleted": wave_id}


@router.get("/{slug}/validation/score")
def get_validation_score(  # deprecated: legacy Runner validation scenarios only
    slug: str = Depends(require_study),
    scenario: str = Query(..., description="Validation scenario name"),
    level: str = Query("sku", description="sku or group"),
    group_type: str = Query("Brand", description="Group type when level=group"),
) -> dict:
    lvl = level if level in ("sku", "group") else "sku"
    try:
        return validation_scenario_score(
            slug,
            scenario,
            level=lvl,  # type: ignore[arg-type]
            group_type=group_type,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

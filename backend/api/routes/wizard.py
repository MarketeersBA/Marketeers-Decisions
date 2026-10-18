"""Wizard routing endpoints."""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
from io import BytesIO
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from api.deps import get_current_client_id
from data.excel_importer import (
    ExcelImportError,
    collect_design_import_warnings,
    import_design_sheet,
    import_hbu_sheet,
)

router = APIRouter(prefix="/api/wizard", tags=["wizard"])

# In-memory store: wizard_id -> {"doc": StudyDocument, "hbu": DataFrame, "client_id": str}
wizard_sessions: dict[str, dict] = {}


def _wizard_for_client(wizard_id: str, client_id: str) -> dict:
    session = wizard_sessions.get(wizard_id)
    if session is None or session.get("client_id") != client_id:
        raise HTTPException(status_code=404, detail="Wizard session not found or expired.")
    return session


@router.post("/design")
async def upload_design(
    file: UploadFile = File(...),
    client_id: str = Depends(get_current_client_id),
) -> dict:
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Please upload an Excel workbook (.xlsx or .xls).",
        )
    try:
        contents = await file.read()
        doc = import_design_sheet(BytesIO(contents))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to parse design sheet: {exc}") from exc

    if doc.meta.unit_cost_source == "design":
        doc.meta.unit_cost_filename = (file.filename or "").strip()
        doc.meta.unit_cost_updated_at = datetime.now(timezone.utc).isoformat()

    wizard_id = str(uuid.uuid4())
    wizard_sessions[wizard_id] = {
        "doc": doc,
        "hbu": None,
        "client_id": client_id,
    }

    return {
        "wizard_id": wizard_id,
        "meta": asdict(doc.meta),
        "products": [asdict(p) for p in doc.products],
        "attributes": [asdict(a) for a in doc.attributes],
        "groups": [asdict(g) for g in doc.groups],
        "segments": [asdict(s) for s in doc.segments],
        "warnings": collect_design_import_warnings(doc),
    }


@router.post("/hbu")
async def upload_hbu(
    wizard_id: str = Form(...),
    file: UploadFile = File(...),
    client_id: str = Depends(get_current_client_id),
) -> dict:
    _wizard_for_client(wizard_id, client_id)

    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Please upload an Excel workbook (.xlsx or .xls).",
        )

    doc = wizard_sessions[wizard_id]["doc"]

    try:
        contents = await file.read()
        hbu_df = import_hbu_sheet(BytesIO(contents), doc)
    except ExcelImportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to parse HBU sheet: {exc}") from exc

    wizard_sessions[wizard_id]["hbu"] = hbu_df

    return {
        "respondent_count": len(hbu_df),
        "columns": list(hbu_df.columns),
    }

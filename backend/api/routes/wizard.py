"""Wizard routing endpoints."""

from __future__ import annotations

from dataclasses import asdict
from io import BytesIO
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from data.excel_importer import ExcelImportError, import_design_sheet, import_hbu_sheet

router = APIRouter(prefix="/api/wizard", tags=["wizard"])

# In-memory store: wizard_id -> {"doc": StudyDocument, "hbu": DataFrame}
wizard_sessions: dict[str, dict] = {}


@router.post("/design")
async def upload_design(file: UploadFile = File(...)) -> dict:
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

    wizard_id = str(uuid.uuid4())
    wizard_sessions[wizard_id] = {
        "doc": doc,
        "hbu": None,
    }

    return {
        "wizard_id": wizard_id,
        "meta": asdict(doc.meta),
        "products": [asdict(p) for p in doc.products],
        "attributes": [asdict(a) for a in doc.attributes],
        "groups": [asdict(g) for g in doc.groups],
        "segments": [asdict(s) for s in doc.segments],
    }


@router.post("/hbu")
async def upload_hbu(
    wizard_id: str = Form(...),
    file: UploadFile = File(...),
) -> dict:
    if wizard_id not in wizard_sessions:
        raise HTTPException(status_code=404, detail="Wizard session not found or expired.")

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

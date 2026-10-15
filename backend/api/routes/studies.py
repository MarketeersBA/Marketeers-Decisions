"""Study registry endpoints."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from io import BytesIO

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from api.deps import get_current_client_id
from api.schemas import CreateStudyRequest, PatchStudyMetaRequest, UpdateStudyRequest
from api.sessions import session_manager
from api.study_access import ensure_study_access
from config import get_storage, slugify
from data.excel_importer import ExcelImportError, import_design_sheet, import_hbu_sheet
from data.study_reingest import apply_hbu_replace, merge_design_replace
from data.study_writer import StudyConflictError, persist_hbu_dataframe, persist_study_document, write_study
from db.repository import StudyRepository
from model.project_core import ProjectCore
from model.study_schema import StudyDocument

router = APIRouter(prefix="/api/studies", tags=["studies"])


def _load_study_doc(client_id: str, slug: str) -> StudyDocument:
    doc, _ = get_storage().load_study(client_id, slug)
    return doc


def _meta_display(slug: str, doc: StudyDocument) -> dict:
    return {
        "slug": slug,
        "study_name": doc.meta.study_name,
        "price_currency_symbol": doc.meta.price_currency_symbol or "€",
        "size_unit_label": doc.meta.size_unit_label or "L",
    }


def _source_updated_at(meta, field: str) -> str:
    from data.study_reingest import effective_source_updated_at

    return effective_source_updated_at(meta, field)


def _data_sources_payload(doc: StudyDocument) -> dict:
    meta = doc.meta
    design_title = meta.design_source_filename.strip() or "Design workbook"
    hbu_title = meta.hbu_source_filename.strip() or "HBU utilities file"
    design_updated = _source_updated_at(meta, "design_source_updated_at")
    hbu_updated = _source_updated_at(meta, "hbu_source_updated_at")

    products = meta.products_count
    if products > 0:
        design_desc = f"Study design workbook · {products:,} products"
    else:
        design_desc = "Study design workbook"

    respondents = meta.respondents_count
    if respondents > 0:
        hbu_desc = f"Choice-based conjoint · {respondents:,} respondents"
    else:
        hbu_desc = "Choice-based conjoint"

    return {
        "sources": [
            {
                "id": "design",
                "initials": "DS",
                "title": design_title,
                "description": design_desc,
                "updatedAt": design_updated,
            },
            {
                "id": "hbu",
                "initials": "HB",
                "title": hbu_title,
                "description": hbu_desc,
                "updatedAt": hbu_updated,
            },
        ],
    }


@router.get("")
def list_studies(client_id: str = Depends(get_current_client_id)) -> list[dict]:
    repo = StudyRepository()
    default_slug = repo.default_slug(client_id)
    out: list[dict] = []
    for entry in repo.list_studies(client_id):
        data_period = ""
        data_source = ""
        if ProjectCore.study_exists(entry.slug, client_id):
            doc = _load_study_doc(client_id, entry.slug)
            data_period = doc.meta.data_period or ""
            data_source = doc.meta.data_source or ""
        out.append(
            {
                "slug": entry.slug,
                "name": entry.name,
                "company": entry.company,
                "status": "ready" if ProjectCore.study_exists(entry.slug, client_id) else "incomplete",
                "isDefault": entry.slug == default_slug,
                "createdAt": entry.created_at,
                "dataPeriod": data_period,
                "dataSource": data_source,
            }
        )
    return out


@router.get("/{slug}/data-sources")
def get_study_data_sources(slug: str, client_id: str = Depends(get_current_client_id)) -> dict:
    ensure_study_access(client_id, slug)
    doc = _load_study_doc(client_id, slug)
    return _data_sources_payload(doc)


def _require_excel_upload(file: UploadFile) -> None:
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Please upload an Excel workbook (.xlsx or .xls).",
        )


@router.post("/{slug}/data-sources/design")
async def replace_study_design_source(
    slug: str,
    file: UploadFile = File(...),
    client_id: str = Depends(get_current_client_id),
) -> dict:
    ensure_study_access(client_id, slug)
    _require_excel_upload(file)
    existing = _load_study_doc(client_id, slug)
    try:
        contents = await file.read()
        imported = import_design_sheet(BytesIO(contents))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to parse design sheet: {exc}") from exc

    doc = merge_design_replace(existing, imported, file.filename or "")
    persist_study_document(slug, doc, client_id)
    session_manager.reload_study_for_slug(client_id, slug)
    return _data_sources_payload(doc)


@router.post("/{slug}/data-sources/hbu")
async def replace_study_hbu_source(
    slug: str,
    file: UploadFile = File(...),
    client_id: str = Depends(get_current_client_id),
) -> dict:
    ensure_study_access(client_id, slug)
    _require_excel_upload(file)
    doc = _load_study_doc(client_id, slug)
    try:
        contents = await file.read()
        hbu_df = import_hbu_sheet(BytesIO(contents), doc)
    except ExcelImportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to parse HBU sheet: {exc}") from exc

    doc = apply_hbu_replace(doc, file.filename or "", len(hbu_df))
    persist_study_document(slug, doc, client_id)
    persist_hbu_dataframe(slug, hbu_df, client_id)
    session_manager.reload_study_for_slug(client_id, slug)
    return _data_sources_payload(doc)


@router.get("/{slug}/meta")
def get_study_meta(slug: str, client_id: str = Depends(get_current_client_id)) -> dict:
    ensure_study_access(client_id, slug)
    doc = _load_study_doc(client_id, slug)
    return _meta_display(slug, doc)


@router.patch("/{slug}/meta")
def patch_study_meta(
    slug: str,
    body: PatchStudyMetaRequest,
    client_id: str = Depends(get_current_client_id),
) -> dict:
    ensure_study_access(client_id, slug)
    doc = _load_study_doc(client_id, slug)
    if body.price_currency_symbol is not None:
        doc.meta.price_currency_symbol = body.price_currency_symbol.strip()
    if body.size_unit_label is not None:
        doc.meta.size_unit_label = body.size_unit_label.strip()
    persist_study_document(slug, doc, client_id)
    session_manager.sync_study_display_meta(
        client_id,
        slug,
        price_currency_symbol=doc.meta.price_currency_symbol,
        size_unit_label=doc.meta.size_unit_label,
    )
    return _meta_display(slug, doc)


@router.patch("/{slug}")
def update_study(
    slug: str,
    body: UpdateStudyRequest,
    client_id: str = Depends(get_current_client_id),
) -> dict:
    ensure_study_access(client_id, slug)
    repo = StudyRepository()
    entry = repo.get_by_slug(client_id, slug)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Study not found: {slug}")

    if body.name is not None or body.company is not None:
        repo.add(
            client_id,
            slug,
            body.name.strip() if body.name is not None else entry.name,
            body.company.strip() if body.company is not None else entry.company,
            set_default=body.set_default,
        )
    elif body.set_default:
        repo.set_default(client_id, slug)

    entry = repo.get_by_slug(client_id, slug) or entry
    default_slug = repo.default_slug(client_id)

    data_period = ""
    data_source = ""
    if ProjectCore.study_exists(slug, client_id) and (
        body.data_period is not None or body.data_source is not None
    ):
        doc = _load_study_doc(client_id, slug)
        if body.data_period is not None:
            doc.meta.data_period = body.data_period.strip()
        if body.data_source is not None:
            doc.meta.data_source = body.data_source.strip()
        persist_study_document(slug, doc, client_id)
        data_period = doc.meta.data_period or ""
        data_source = doc.meta.data_source or ""
    elif ProjectCore.study_exists(slug, client_id):
        doc = _load_study_doc(client_id, slug)
        data_period = doc.meta.data_period or ""
        data_source = doc.meta.data_source or ""

    return {
        "slug": entry.slug,
        "name": entry.name,
        "company": entry.company,
        "isDefault": default_slug == slug,
        "dataPeriod": data_period,
        "dataSource": data_source,
    }


@router.delete("/{slug}")
def delete_study(slug: str, client_id: str = Depends(get_current_client_id)) -> dict:
    repo = StudyRepository()
    if repo.get_by_slug(client_id, slug) is None:
        raise HTTPException(status_code=404, detail=f"Study not found: {slug}")
    get_storage().delete_study_tree(client_id, slug)
    repo.remove(client_id, slug)
    return {"ok": True, "slug": slug}


@router.post("")
def create_study(body: CreateStudyRequest, client_id: str = Depends(get_current_client_id)) -> dict:
    from api.routes.wizard import wizard_sessions

    session = wizard_sessions.get(body.wizard_id)
    if session is None or session.get("client_id") != client_id:
        raise HTTPException(status_code=404, detail="Wizard session not found or expired.")
    doc = session["doc"]
    hbu_df = session["hbu"]
    if doc is None or hbu_df is None:
        raise HTTPException(
            status_code=400,
            detail="Incomplete wizard session data. Make sure design and HBU files are parsed.",
        )

    doc.meta.study_name = body.name.strip()
    doc.meta.company_name = body.company.strip()
    doc.meta.category = body.category.strip()
    doc.meta.company_location = body.market.strip()
    doc.meta.exponent_factor = body.exponent_factor
    doc.meta.msu = body.msu
    doc.meta.su = body.su
    doc.meta.vsu = body.vsu
    doc.meta.price_currency_symbol = body.price_currency_symbol.strip()
    doc.meta.size_unit_label = body.size_unit_label.strip()
    doc.meta.design_source_filename = (body.design_source_filename or "").strip()
    doc.meta.hbu_source_filename = (body.hbu_source_filename or "").strip()
    doc.meta.data_period = (body.data_period or "").strip()
    doc.meta.data_source = (body.data_source or "").strip()
    now = datetime.now(timezone.utc).isoformat()
    doc.meta.ingested_at = now
    doc.meta.design_source_updated_at = now
    doc.meta.hbu_source_updated_at = now

    repo = StudyRepository()
    storage = get_storage()
    base_slug = slugify(doc.meta.study_name or "unnamed_study")
    study_exists = repo.exists(client_id, base_slug) or storage.study_exists(client_id, base_slug)

    target_slug = base_slug
    if study_exists and not body.allow_overwrite:
        if body.auto_disambiguate:
            target_slug = repo.make_unique_slug(client_id, doc.meta.study_name)
        else:
            raise HTTPException(
                status_code=409,
                detail=f"Study '{doc.meta.study_name}' already exists (slug: '{base_slug}'). Set allow_overwrite to replace or auto_disambiguate to save as a copy.",
            )

    try:
        slug = write_study(
            doc,
            hbu_df,
            client_id=client_id,
            slug=target_slug,
            allow_overwrite=body.allow_overwrite,
        )
    except StudyConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create study: {exc}") from exc

    wizard_sessions.pop(body.wizard_id, None)

    return {
        "slug": slug,
        "name": doc.meta.study_name,
        "company": doc.meta.company_name,
    }

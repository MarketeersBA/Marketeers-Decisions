"""Replace design or HBU on an existing study while preserving catalog meta."""

from __future__ import annotations

from datetime import datetime, timezone

from model.study_schema import StudyDocument, StudyMeta


def effective_source_updated_at(meta: StudyMeta, field: str) -> str:
    """Per-source timestamp, falling back to study ingest for legacy studies."""
    value = (getattr(meta, field, "") or "").strip()
    if value:
        return value
    return (meta.ingested_at or "").strip()


def _copy_study_identity_meta(target: StudyMeta, source: StudyMeta) -> None:
    target.study_name = source.study_name
    target.study_description = source.study_description
    target.company_name = source.company_name
    target.company_location = source.company_location
    target.category = source.category
    target.msu = source.msu
    target.su = source.su
    target.vsu = source.vsu
    target.exponent_factor = source.exponent_factor
    target.price_currency_symbol = source.price_currency_symbol
    target.size_unit_label = source.size_unit_label
    target.data_period = source.data_period
    target.data_source = source.data_source


def merge_design_replace(existing: StudyDocument, imported: StudyDocument, filename: str) -> StudyDocument:
    """Apply a new design workbook to an existing study slug."""
    _copy_study_identity_meta(imported.meta, existing.meta)
    imported.meta.design_source_filename = filename.strip()
    imported.meta.hbu_source_filename = existing.meta.hbu_source_filename
    imported.meta.hbu_source_updated_at = effective_source_updated_at(
        existing.meta, "hbu_source_updated_at"
    )
    imported.meta.ingested_at = existing.meta.ingested_at
    imported.meta.respondents_count = existing.meta.respondents_count
    imported.meta.products_count = len(imported.products)
    imported.meta.design_source_updated_at = datetime.now(timezone.utc).isoformat()
    return imported


def apply_hbu_replace(doc: StudyDocument, filename: str, respondent_count: int) -> StudyDocument:
    if not (doc.meta.design_source_updated_at or "").strip():
        doc.meta.design_source_updated_at = effective_source_updated_at(
            doc.meta, "design_source_updated_at"
        )
    doc.meta.hbu_source_filename = filename.strip()
    doc.meta.respondents_count = respondent_count
    doc.meta.hbu_source_updated_at = datetime.now(timezone.utc).isoformat()
    return doc

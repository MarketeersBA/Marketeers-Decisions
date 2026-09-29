"""Per-source update timestamps when replacing design or HBU."""

from __future__ import annotations

from model.study_schema import StudyDocument, StudyMeta
from data.study_reingest import apply_hbu_replace, merge_design_replace


def _doc(meta: StudyMeta | None = None) -> StudyDocument:
    return StudyDocument(meta=meta or StudyMeta())


def test_design_replace_preserves_hbu_updated_at_from_ingest() -> None:
    existing = _doc(
        StudyMeta(
            ingested_at="2024-06-01T12:00:00+00:00",
            hbu_source_filename="old-hbu.xlsx",
            respondents_count=100,
        )
    )
    imported = _doc(StudyMeta(study_name="Imported"))

    merged = merge_design_replace(existing, imported, "new-design.xlsx")

    assert merged.meta.design_source_updated_at
    assert merged.meta.design_source_updated_at != "2024-06-01T12:00:00+00:00"
    assert merged.meta.hbu_source_updated_at == "2024-06-01T12:00:00+00:00"
    assert merged.meta.ingested_at == "2024-06-01T12:00:00+00:00"


def test_design_replace_preserves_explicit_hbu_timestamp() -> None:
    existing = _doc(
        StudyMeta(
            ingested_at="2024-06-01T12:00:00+00:00",
            hbu_source_updated_at="2023-01-15T08:00:00+00:00",
        )
    )
    imported = _doc()

    merged = merge_design_replace(existing, imported, "new-design.xlsx")

    assert merged.meta.hbu_source_updated_at == "2023-01-15T08:00:00+00:00"


def test_hbu_replace_preserves_design_timestamp() -> None:
    doc = _doc(
        StudyMeta(
            ingested_at="2024-06-01T12:00:00+00:00",
            design_source_filename="design.xlsx",
        )
    )

    updated = apply_hbu_replace(doc, "new-hbu.xlsx", 50)

    assert updated.meta.design_source_updated_at == "2024-06-01T12:00:00+00:00"
    assert updated.meta.hbu_source_updated_at
    assert updated.meta.hbu_source_updated_at != "2024-06-01T12:00:00+00:00"
    assert updated.meta.ingested_at == "2024-06-01T12:00:00+00:00"

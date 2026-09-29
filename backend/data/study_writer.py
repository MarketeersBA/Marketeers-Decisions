"""Write folder-per-study storage from imported Excel data."""

from __future__ import annotations

import pandas as pd

from config import get_storage
from model.study_schema import StudyDocument


def write_study(doc: StudyDocument, hbu_df: pd.DataFrame, client_id: str | None = None) -> str:
    """Persist study payloads and register in catalog. Returns slug."""
    from api.deps import resolve_client_id
    from db.repository import StudyRepository

    cid = client_id or resolve_client_id()
    slug = get_storage().write_study(cid, doc, hbu_df)
    repo = StudyRepository()
    repo.add(
        client_id=cid,
        slug=slug,
        name=doc.meta.study_name or slug,
        company=doc.meta.company_name or "",
        set_default=True,
    )
    return slug


def persist_study_document(slug: str, doc: StudyDocument, client_id: str | None = None) -> None:
    """Rewrite study.json only (does not touch hbu.parquet)."""
    from api.deps import resolve_client_id

    cid = client_id or resolve_client_id()
    get_storage().persist_study_document(cid, slug, doc)


def persist_hbu_dataframe(slug: str, hbu_df: pd.DataFrame, client_id: str | None = None) -> None:
    """Rewrite hbu.parquet only."""
    from api.deps import resolve_client_id

    cid = client_id or resolve_client_id()
    get_storage().persist_hbu_dataframe(cid, slug, hbu_df)

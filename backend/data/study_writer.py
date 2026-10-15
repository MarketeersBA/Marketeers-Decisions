"""Write folder-per-study storage from imported Excel data."""

from __future__ import annotations

import logging
import pandas as pd

from config import get_storage, slugify
from model.study_schema import StudyDocument

logger = logging.getLogger(__name__)


class StudyConflictError(RuntimeError):
    """Raised when attempting to create a study with a slug that already exists without allow_overwrite."""
    pass


def write_study(
    doc: StudyDocument,
    hbu_df: pd.DataFrame,
    client_id: str | None = None,
    slug: str | None = None,
    allow_overwrite: bool = True,
) -> str:
    """Persist study payloads and register in catalog. Returns slug."""
    from api.deps import resolve_client_id
    from db.repository import StudyRepository

    cid = client_id or resolve_client_id()
    repo = StudyRepository()
    storage = get_storage()

    target_slug = slug or slugify(doc.meta.study_name or "unnamed_study")

    exists_in_catalog = repo.exists(cid, target_slug)
    exists_in_storage = storage.study_exists(cid, target_slug)
    is_new = not exists_in_catalog and not exists_in_storage

    if not allow_overwrite and (exists_in_catalog or exists_in_storage):
        raise StudyConflictError(
            f"Study '{target_slug}' already exists for client '{cid}'."
        )

    written_slug = storage.write_study(cid, doc, hbu_df, slug=target_slug)

    try:
        repo.add(
            client_id=cid,
            slug=written_slug,
            name=doc.meta.study_name or written_slug,
            company=doc.meta.company_name or "",
            set_default=True,
            allow_overwrite=allow_overwrite,
        )
    except Exception as exc:
        if is_new:
            try:
                storage.delete_study_tree(cid, written_slug)
            except Exception as cleanup_err:
                logger.warning(
                    "Failed to rollback study storage for %s/%s after DB error: %s",
                    cid,
                    written_slug,
                    cleanup_err,
                )
        raise exc

    return written_slug


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

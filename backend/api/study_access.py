"""Tenant-scoped study access checks."""

from __future__ import annotations

from fastapi import Depends, HTTPException

from api.deps import get_current_client_id
from config import get_storage
from db.repository import StudyRepository


def ensure_study_access(client_id: str, slug: str) -> None:
    """404 if study is not registered for this client or payloads are missing."""
    repo = StudyRepository()
    if repo.get_by_slug(client_id, slug) is None:
        raise HTTPException(status_code=404, detail=f"Study not found: {slug}")
    if not get_storage().study_exists(client_id, slug):
        raise HTTPException(status_code=404, detail=f"Study not found: {slug}")


def require_study(
    slug: str,
    client_id: str = Depends(get_current_client_id),
) -> str:
    """FastAPI dependency: path slug must belong to client and have storage payloads."""
    ensure_study_access(client_id, slug)
    return slug

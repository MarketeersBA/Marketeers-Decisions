"""Study catalog repository (replaces StudyIndex)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError

from config import slugify
from db.models import ClientRow, OptimizerJobRow, StudyRow, new_uuid
from db.session import session_scope

# Sentinel so upsert can leave payload / finished_at unchanged on progress heartbeats.
_UNSET: Any = object()

INTERRUPTED_JOB_ERROR = (
    "Optimization was interrupted by a server restart. Run it again."
)
JOB_RETENTION_DAYS = 7
_TERMINAL_STATUSES = frozenset({"done", "cancelled", "error"})


@dataclass
class StudyEntry:
    slug: str
    name: str
    company: str = ""
    created_at: str = ""
    is_default: bool = False


class StudyRepository:
    def list_studies(self, client_id: str) -> list[StudyEntry]:
        with session_scope() as session:
            rows = session.scalars(
                select(StudyRow)
                .where(StudyRow.client_id == client_id, StudyRow.deleted_at.is_(None))
                .order_by(StudyRow.name)
            ).all()
            return [
                StudyEntry(
                    slug=r.slug,
                    name=r.name,
                    company=r.company,
                    created_at=r.created_at.isoformat() if r.created_at else "",
                    is_default=r.is_default,
                )
                for r in rows
            ]

    def default_slug(self, client_id: str) -> str:
        with session_scope() as session:
            row = session.scalar(
                select(StudyRow)
                .where(
                    StudyRow.client_id == client_id,
                    StudyRow.is_default.is_(True),
                    StudyRow.deleted_at.is_(None),
                )
                .limit(1)
            )
            if row:
                return row.slug
            first = session.scalar(
                select(StudyRow)
                .where(StudyRow.client_id == client_id, StudyRow.deleted_at.is_(None))
                .limit(1)
            )
            return first.slug if first else ""

    def get_by_slug(self, client_id: str, slug: str) -> StudyEntry | None:
        with session_scope() as session:
            row = session.scalar(
                select(StudyRow).where(
                    StudyRow.client_id == client_id,
                    StudyRow.slug == slug,
                    StudyRow.deleted_at.is_(None),
                )
            )
            if not row:
                return None
            return StudyEntry(
                slug=row.slug,
                name=row.name,
                company=row.company,
                created_at=row.created_at.isoformat() if row.created_at else "",
                is_default=row.is_default,
            )

    def exists(self, client_id: str, slug: str, include_deleted: bool = False) -> bool:
        with session_scope() as session:
            stmt = select(StudyRow).where(
                StudyRow.client_id == client_id,
                StudyRow.slug == slug,
            )
            if not include_deleted:
                stmt = stmt.where(StudyRow.deleted_at.is_(None))
            return session.scalar(stmt) is not None

    def make_unique_slug(self, client_id: str, name: str) -> str:
        """Derive a slug from name and disambiguate with numeric suffixes if a collision exists."""
        from config import get_storage
        base_slug = slugify(name)
        storage = get_storage()
        candidate = base_slug
        counter = 2
        while self.exists(client_id, candidate, include_deleted=True) or storage.study_exists(client_id, candidate):
            candidate = f"{base_slug}_{counter}"
            counter += 1
        return candidate

    def add(
        self,
        client_id: str,
        slug: str,
        name: str,
        company: str = "",
        *,
        set_default: bool = True,
        allow_overwrite: bool = True,
    ) -> StudyEntry:
        from data.study_writer import StudyConflictError

        with session_scope() as session:
            self._ensure_client(session, client_id)
            row = session.scalar(
                select(StudyRow).where(StudyRow.client_id == client_id, StudyRow.slug == slug)
            )
            if row:
                if not allow_overwrite and row.deleted_at is None:
                    raise StudyConflictError(
                        f"Study '{slug}' already exists for client '{client_id}'."
                    )
                row.name = name
                row.company = company
                row.deleted_at = None
                if set_default:
                    self._set_default(session, client_id, slug)
            else:
                if set_default:
                    session.execute(
                        update(StudyRow)
                        .where(StudyRow.client_id == client_id)
                        .values(is_default=False)
                    )
                row = StudyRow(
                    id=new_uuid(),
                    client_id=client_id,
                    slug=slug,
                    name=name,
                    company=company,
                    is_default=set_default,
                )
                session.add(row)
            session.flush()
            return StudyEntry(
                slug=row.slug,
                name=row.name,
                company=row.company,
                created_at=row.created_at.isoformat() if row.created_at else "",
                is_default=row.is_default,
            )

    def add_by_name(
        self, client_id: str, name: str, company: str = "", *, set_default: bool = True
    ) -> StudyEntry:
        slug = slugify(name)
        return self.add(client_id, slug, name, company, set_default=set_default)

    def remove(self, client_id: str, slug: str) -> None:
        with session_scope() as session:
            row = session.scalar(
                select(StudyRow).where(StudyRow.client_id == client_id, StudyRow.slug == slug)
            )
            if not row:
                return
            was_default = row.is_default
            row.deleted_at = datetime.now(timezone.utc)
            row.is_default = False
            session.flush()
            if was_default:
                nxt = session.scalar(
                    select(StudyRow)
                    .where(StudyRow.client_id == client_id, StudyRow.deleted_at.is_(None))
                    .limit(1)
                )
                if nxt:
                    nxt.is_default = True

    def set_default(self, client_id: str, slug: str) -> None:
        with session_scope() as session:
            self._set_default(session, client_id, slug)

    def _set_default(self, session, client_id: str, slug: str) -> None:  # noqa: ANN001
        session.execute(
            update(StudyRow).where(StudyRow.client_id == client_id).values(is_default=False)
        )
        row = session.scalar(
            select(StudyRow).where(
                StudyRow.client_id == client_id,
                StudyRow.slug == slug,
                StudyRow.deleted_at.is_(None),
            )
        )
        if row:
            row.is_default = True

    def _ensure_client(self, session, client_id: str) -> None:  # noqa: ANN001
        if session.get(ClientRow, client_id) is None:
            session.add(ClientRow(id=client_id, email=None))

    def get_or_create_client(self, cognito_sub: str, email: str | None) -> str:
        """Return the tenant id for a Cognito subject, creating the row on first login."""
        with session_scope() as session:
            row = session.scalar(select(ClientRow).where(ClientRow.cognito_sub == cognito_sub))
            if row:
                if email and row.email != email:
                    row.email = email
                return row.id
            client_id = new_uuid()
            session.add(ClientRow(id=client_id, email=email, cognito_sub=cognito_sub))
            try:
                session.flush()
            except IntegrityError:
                session.rollback()
                row = session.scalar(select(ClientRow).where(ClientRow.cognito_sub == cognito_sub))
                if row is None:
                    raise
                return row.id
            return client_id


class OptimizerJobRepository:
    def upsert(
        self,
        job_id: str,
        client_id: str,
        study_id: str,
        *,
        status: str,
        evals: int = 0,
        estimated_evals: int = 0,
        best_obj: float = 0.0,
        error: str | None = None,
        payload: Any = _UNSET,
        finished_at: Any = _UNSET,
    ) -> None:
        with session_scope() as session:
            row = session.get(OptimizerJobRow, job_id)
            if row is None:
                row = OptimizerJobRow(
                    id=job_id,
                    client_id=client_id,
                    study_id=study_id,
                )
                session.add(row)
            row.status = status
            row.evals = evals
            row.estimated_evals = estimated_evals
            row.best_obj = best_obj
            row.error = error
            if payload is not _UNSET:
                row.payload = payload
            now = datetime.now(timezone.utc)
            if finished_at is not _UNSET:
                row.finished_at = finished_at
            elif status in _TERMINAL_STATUSES and row.finished_at is None:
                row.finished_at = now
            row.updated_at = now

    def get(self, job_id: str, client_id: str) -> dict | None:
        with session_scope() as session:
            row = session.get(OptimizerJobRow, job_id)
            if not row or row.client_id != client_id:
                return None
            study = session.get(StudyRow, row.study_id)
            return {
                "status": row.status,
                "evals": row.evals,
                "estimated_evals": row.estimated_evals,
                "best_obj": row.best_obj,
                "error": row.error,
                "payload": row.payload,
                "finished_at": row.finished_at.isoformat() if row.finished_at else None,
                "slug": study.slug if study else None,
            }

    def study_id_for_slug(self, client_id: str, slug: str) -> str | None:
        with session_scope() as session:
            row = session.scalar(
                select(StudyRow).where(
                    StudyRow.client_id == client_id,
                    StudyRow.slug == slug,
                    StudyRow.deleted_at.is_(None),
                )
            )
            return row.id if row else None

    def reconcile_interrupted(self, error: str = INTERRUPTED_JOB_ERROR) -> int:
        """Mark leftover running jobs as error after a process restart."""
        now = datetime.now(timezone.utc)
        with session_scope() as session:
            rows = session.scalars(
                select(OptimizerJobRow).where(OptimizerJobRow.status == "running")
            ).all()
            for row in rows:
                row.status = "error"
                row.error = error
                row.finished_at = now
                row.updated_at = now
            return len(rows)

    def cleanup_expired(self, max_age_days: int = JOB_RETENTION_DAYS) -> int:
        """Delete terminal jobs older than the retention window."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
        with session_scope() as session:
            # Prefer finished_at; fall back to updated_at for rows written before the column existed.
            result = session.execute(
                delete(OptimizerJobRow).where(
                    OptimizerJobRow.status.in_(tuple(_TERMINAL_STATUSES)),
                    (
                        (OptimizerJobRow.finished_at.is_not(None) & (OptimizerJobRow.finished_at < cutoff))
                        | (
                            OptimizerJobRow.finished_at.is_(None)
                            & (OptimizerJobRow.updated_at < cutoff)
                        )
                    ),
                )
            )
            return int(result.rowcount or 0)

"""Study catalog repository (replaces StudyIndex)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select, update

from config import slugify
from db.models import ClientRow, OptimizerJobRow, StudyRow, new_uuid
from db.session import session_scope


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

    def add(
        self,
        client_id: str,
        slug: str,
        name: str,
        company: str = "",
        *,
        set_default: bool = True,
    ) -> StudyEntry:
        with session_scope() as session:
            self._ensure_client(session, client_id)
            row = session.scalar(
                select(StudyRow).where(StudyRow.client_id == client_id, StudyRow.slug == slug)
            )
            if row:
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
        payload: dict | None = None,
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
            row.payload = payload
            row.updated_at = datetime.now(timezone.utc)

    def get(self, job_id: str) -> dict | None:
        with session_scope() as session:
            row = session.get(OptimizerJobRow, job_id)
            if not row:
                return None
            return {
                "status": row.status,
                "evals": row.evals,
                "estimated_evals": row.estimated_evals,
                "best_obj": row.best_obj,
                "error": row.error,
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

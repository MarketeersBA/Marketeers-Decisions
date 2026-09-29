"""Create schema and seed dev client; migrate legacy index.json when DB is empty."""

from __future__ import annotations

import json

from sqlalchemy import func, select

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

from config import MARKET_SIM_AUTH, MARKET_SIM_DEV_CLIENT_ID, STUDY_INDEX_FILE
from db.models import ClientRow, StudyRow, new_uuid
from db.migrate import upgrade_head
from db.session import get_engine, session_scope


def _apply_schema() -> None:
    """Alembic upgrade; stamp head if schema predates alembic_version (legacy create_all)."""
    engine = get_engine()
    insp = inspect(engine)
    backend_dir = Path(__file__).resolve().parent.parent
    cfg = Config(str(backend_dir / "alembic.ini"))
    if insp.has_table("clients") and not insp.has_table("alembic_version"):
        command.stamp(cfg, "head")
        return
    upgrade_head()


def init_db() -> None:
    _apply_schema()
    with session_scope() as session:
        _ensure_dev_client(session)
        _import_legacy_index_if_empty(session)


def _ensure_dev_client(session) -> None:  # noqa: ANN001
    if MARKET_SIM_AUTH != "dev":
        return
    existing = session.get(ClientRow, MARKET_SIM_DEV_CLIENT_ID)
    if existing:
        return
    session.add(
        ClientRow(
            id=MARKET_SIM_DEV_CLIENT_ID,
            email="dev@local",
        )
    )


def _import_legacy_index_if_empty(session) -> None:  # noqa: ANN001
    count = session.scalar(select(func.count()).select_from(StudyRow))
    if count:
        return
    if not STUDY_INDEX_FILE.exists():
        return
    with STUDY_INDEX_FILE.open(encoding="utf-8") as fh:
        data = json.load(fh)
    default_slug = data.get("research_start", "") or ""
    client_id = MARKET_SIM_DEV_CLIENT_ID
    for item in data.get("studies", []):
        slug = item.get("slug") or ""
        if not slug:
            continue
        session.add(
            StudyRow(
                id=new_uuid(),
                client_id=client_id,
                slug=slug,
                name=item.get("name", slug),
                company=item.get("company", ""),
                is_default=slug == default_slug,
            )
        )

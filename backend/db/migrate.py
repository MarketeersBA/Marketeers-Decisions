"""Run Alembic migrations (schema source of truth for prod)."""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config


def upgrade_head() -> None:
    backend_dir = Path(__file__).resolve().parent.parent
    cfg = Config(str(backend_dir / "alembic.ini"))
    command.upgrade(cfg, "head")

"""Alembic upgrade smoke test on SQLite."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect


def test_alembic_upgrade_head_sqlite(tmp_path: Path) -> None:
    db_path = tmp_path / "alembic_test.db"
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"
    backend_dir = Path(__file__).resolve().parent.parent
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=backend_dir,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr or result.stdout

    engine = create_engine(env["DATABASE_URL"])
    insp = inspect(engine)
    assert insp.has_table("clients")
    assert insp.has_table("studies")
    assert insp.has_table("optimizer_jobs")
    assert insp.has_table("alembic_version")
    job_cols = {c["name"] for c in insp.get_columns("optimizer_jobs")}
    assert "finished_at" in job_cols
    assert "payload" in job_cols

"""Shared pytest config for market_simulator tests."""

from __future__ import annotations

import pytest

import config
from api.context import current_client_id
from config import MARKET_SIM_DEV_CLIENT_ID, ensure_directories


DEMO_STUDY_SLUG = "Demo_Study"


@pytest.fixture(autouse=True)
def _dev_client_context(monkeypatch) -> None:
    monkeypatch.setattr(config, "MARKET_SIM_AUTH", "dev")
    token = current_client_id.set(MARKET_SIM_DEV_CLIENT_ID)
    yield
    current_client_id.reset(token)


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "golden: parity vs desktop .exe Chart Analysis exports (REQ-QA-01; skipped until implemented)",
    )


def pytest_sessionstart(session: pytest.Session) -> None:
    """Ensure Demo_Study exists so integration tests do not skip on empty STUDIES_DIR."""
    from model.project_core import ProjectCore

    ensure_directories()
    token = current_client_id.set(MARKET_SIM_DEV_CLIENT_ID)
    try:
        if ProjectCore.study_exists(DEMO_STUDY_SLUG):
            return
        from scripts.smoke_study import _create_demo_study

        slug = _create_demo_study()
        if slug != DEMO_STUDY_SLUG:
            raise RuntimeError(
                f"Expected demo study slug {DEMO_STUDY_SLUG!r}, got {slug!r}"
            )
        if not ProjectCore.study_exists(DEMO_STUDY_SLUG):
            raise RuntimeError(
                f"Failed to create {DEMO_STUDY_SLUG} for the test suite"
            )
    finally:
        current_client_id.reset(token)


@pytest.fixture
def demo_slug() -> str:
    """Canonical Demo_Study slug; fails loudly if session bootstrap did not create it."""
    from model.project_core import ProjectCore

    if not ProjectCore.study_exists(DEMO_STUDY_SLUG):
        pytest.fail(
            f"{DEMO_STUDY_SLUG} is missing after session setup. "
            "Check STUDIES_DIR permissions / smoke_study._create_demo_study."
        )
    return DEMO_STUDY_SLUG

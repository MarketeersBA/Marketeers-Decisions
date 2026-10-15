"""Shared pytest config for market_simulator tests."""

from __future__ import annotations

import pytest

import config
from api.context import current_client_id
from config import MARKET_SIM_DEV_CLIENT_ID


@pytest.fixture(autouse=True)
def _dev_client_context(monkeypatch) -> None:
    monkeypatch.setattr(config, "MARKET_SIM_AUTH", "dev")
    token = current_client_id.set(MARKET_SIM_DEV_CLIENT_ID)
    yield
    current_client_id.reset(token)


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "golden: parity vs desktop .exe Chart Analysis exports (REQ-QA-01; stubbed until fixtures exist)",
    )

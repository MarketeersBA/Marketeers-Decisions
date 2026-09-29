"""FastAPI dependencies for tenancy and auth (Phase 1: dev client only)."""

from __future__ import annotations

from fastapi import Request

from api.context import current_client_id
from config import MARKET_SIM_AUTH, MARKET_SIM_DEV_CLIENT_ID


def resolve_client_id() -> str:
    """Effective client id for this context (request or explicit test override)."""
    cid = current_client_id.get()
    if cid:
        return cid
    if MARKET_SIM_AUTH == "dev":
        return MARKET_SIM_DEV_CLIENT_ID
    raise RuntimeError("No client context; configure MARKET_SIM_AUTH=dev or set current_client_id")


async def get_current_client_id(request: Request) -> str:  # noqa: ARG001
    return resolve_client_id()

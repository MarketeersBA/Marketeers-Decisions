"""FastAPI dependencies for tenancy and auth."""

from __future__ import annotations

from fastapi import HTTPException, Request

import config
from api.context import current_client_id


def resolve_client_id() -> str:
    """Effective client id for this context (request or explicit test override)."""
    cid = current_client_id.get()
    if cid:
        return cid
    if config.MARKET_SIM_AUTH == "dev":
        return config.MARKET_SIM_DEV_CLIENT_ID
    raise RuntimeError("No client context; authenticate or set MARKET_SIM_AUTH=dev")


async def get_current_client_id(request: Request) -> str:  # noqa: ARG001
    cid = current_client_id.get()
    if cid:
        return cid
    if config.MARKET_SIM_AUTH == "dev":
        return config.MARKET_SIM_DEV_CLIENT_ID
    raise HTTPException(status_code=401, detail="Not authenticated")

"""HTTP middleware."""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from api.context import current_client_id
from config import MARKET_SIM_AUTH, MARKET_SIM_DEV_CLIENT_ID


class ClientContextMiddleware(BaseHTTPMiddleware):
    """Attach tenant client_id to each request (dev mode until Cognito)."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if MARKET_SIM_AUTH == "dev":
            token = current_client_id.set(MARKET_SIM_DEV_CLIENT_ID)
            try:
                return await call_next(request)
            finally:
                current_client_id.reset(token)
        return await call_next(request)

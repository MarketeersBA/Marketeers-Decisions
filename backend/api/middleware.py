"""HTTP middleware."""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

import config
from api.auth import AuthError, cognito_configured, mock_enabled, verify_id_token
from api.context import current_client_id

_PUBLIC_PATHS = {
    "/api/health",
    "/api/auth/config",
    "/docs",
    "/redoc",
    "/openapi.json",
}


def _is_public(path: str) -> bool:
    if path in _PUBLIC_PATHS or path.startswith("/docs") or path.startswith("/redoc"):
        return True
    if path.startswith("/api/auth/mock/"):
        return True
    return not path.startswith("/api/")


class ClientContextMiddleware(BaseHTTPMiddleware):
    """Attach the authenticated tenant to each API request."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if config.MARKET_SIM_AUTH == "dev":
            token = current_client_id.set(config.MARKET_SIM_DEV_CLIENT_ID)
            try:
                return await call_next(request)
            finally:
                current_client_id.reset(token)

        if request.method == "OPTIONS" or _is_public(request.url.path):
            return await call_next(request)

        if config.MARKET_SIM_AUTH == "mock":
            if not mock_enabled():
                return JSONResponse({"detail": "Mock auth is disabled"}, status_code=500)
        elif not cognito_configured():
            return JSONResponse({"detail": "Cognito is not configured"}, status_code=500)

        header = request.headers.get("authorization", "")
        if not header.lower().startswith("bearer "):
            return JSONResponse({"detail": "Not authenticated"}, status_code=401)
        raw = header.split(" ", 1)[1].strip()
        if not raw:
            return JSONResponse({"detail": "Not authenticated"}, status_code=401)
        try:
            claims = verify_id_token(raw)
        except AuthError:
            return JSONResponse({"detail": "Invalid or expired token"}, status_code=401)

        from db.repository import StudyRepository

        client_id = StudyRepository().get_or_create_client(
            str(claims["sub"]),
            claims.get("email") if isinstance(claims.get("email"), str) else None,
        )
        token = current_client_id.set(client_id)
        try:
            return await call_next(request)
        finally:
            current_client_id.reset(token)

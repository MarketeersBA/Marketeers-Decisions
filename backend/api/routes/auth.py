"""Public auth configuration for the SPA."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import config
from api.auth import cognito_configured, mock_enabled
from api.mock_store import MockAuthError, confirm, login, signup

router = APIRouter(prefix="/api/auth", tags=["auth"])


class Credentials(BaseModel):
    email: str
    password: str


class ConfirmBody(BaseModel):
    email: str
    code: str


def _mock_only() -> None:
    if not mock_enabled():
        raise HTTPException(status_code=404, detail="Not found")


def _reject(exc: MockAuthError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.get("/config")
def auth_config() -> dict:
    if mock_enabled():
        return {"mode": "mock"}
    if config.MARKET_SIM_AUTH == "cognito" and cognito_configured():
        return {
            "mode": "cognito",
            "region": config.COGNITO_REGION,
            "userPoolId": config.COGNITO_USER_POOL_ID,
            "clientId": config.COGNITO_APP_CLIENT_ID,
        }
    return {"mode": "dev"}


@router.post("/mock/signup")
def mock_signup(body: Credentials) -> dict:
    _mock_only()
    try:
        signup(body.email, body.password)
    except MockAuthError as exc:
        raise _reject(exc) from exc
    return {"ok": True}


@router.post("/mock/confirm")
def mock_confirm(body: ConfirmBody) -> dict:
    _mock_only()
    try:
        confirm(body.email, body.code)
    except MockAuthError as exc:
        raise _reject(exc) from exc
    return {"ok": True}


@router.post("/mock/login")
def mock_login(body: Credentials) -> dict:
    _mock_only()
    try:
        token = login(body.email, body.password)
    except MockAuthError as exc:
        raise _reject(exc) from exc
    return {"idToken": token}

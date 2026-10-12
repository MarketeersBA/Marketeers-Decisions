"""Cognito and development-mock ID token verification."""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any
from urllib.request import urlopen

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt import PyJWTError
from jwt.algorithms import RSAAlgorithm

import config

_JWKS_TTL_SECONDS = 3600
_jwks_cache: dict[str, Any] = {"keys": None, "fetched_at": 0.0}
_key_lock = threading.Lock()

MOCK_ISSUER = "http://market-sim.local/mock"
MOCK_AUDIENCE = "mock-client"
MOCK_KID = "mock-key"


class AuthError(Exception):
    """Token is missing, invalid, or expired."""


def cognito_configured() -> bool:
    return bool(
        config.COGNITO_REGION and config.COGNITO_USER_POOL_ID and config.COGNITO_APP_CLIENT_ID
    )


def mock_enabled() -> bool:
    """Local token issuer. Never active outside development."""
    return config.MARKET_SIM_AUTH == "mock" and config.APP_ENV == "development"


def mock_dir() -> Path:
    return Path(config.MARKET_SIM_DATA_DIR) / "mock_auth"


def issuer() -> str:
    if mock_enabled():
        return MOCK_ISSUER
    return (
        f"https://cognito-idp.{config.COGNITO_REGION}.amazonaws.com/{config.COGNITO_USER_POOL_ID}"
    )


def token_audience() -> str:
    if mock_enabled():
        return MOCK_AUDIENCE
    return config.COGNITO_APP_CLIENT_ID


def jwks_url() -> str:
    return f"{issuer()}/.well-known/jwks.json"


def clear_jwks_cache() -> None:
    _jwks_cache["keys"] = None
    _jwks_cache["fetched_at"] = 0.0


def _private_key():
    path = mock_dir() / "key.pem"
    with _key_lock:
        if path.exists():
            return serialization.load_pem_private_key(path.read_bytes(), password=None)
        path.parent.mkdir(parents=True, exist_ok=True)
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        path.write_bytes(
            key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
        )
        return key


def mock_jwks() -> dict[str, Any]:
    public = json.loads(RSAAlgorithm.to_jwk(_private_key().public_key()))
    public.update({"kid": MOCK_KID, "use": "sig", "alg": "RS256"})
    return {"keys": [public]}


def issue_mock_token(sub: str, email: str, *, exp: int | None = None) -> str:
    payload = {
        "sub": sub,
        "email": email,
        "aud": MOCK_AUDIENCE,
        "iss": MOCK_ISSUER,
        "token_use": "id",
        "exp": exp if exp is not None else int(time.time()) + 3600,
    }
    encoded = jwt.encode(payload, _private_key(), algorithm="RS256", headers={"kid": MOCK_KID})
    return encoded if isinstance(encoded, str) else encoded.decode()


def _fetch_jwks() -> dict[str, Any]:
    if mock_enabled():
        return mock_jwks()
    now = time.time()
    cached = _jwks_cache["keys"]
    if cached is not None and now - float(_jwks_cache["fetched_at"]) < _JWKS_TTL_SECONDS:
        return cached
    with urlopen(jwks_url(), timeout=5) as resp:  # noqa: S310 — Cognito JWKS URL
        data = json.load(resp)
    _jwks_cache["keys"] = data
    _jwks_cache["fetched_at"] = now
    return data


def _signing_key(token: str) -> Any:
    try:
        header = jwt.get_unverified_header(token)
    except PyJWTError as exc:
        raise AuthError("Invalid token") from exc
    kid = header.get("kid")
    if not kid:
        raise AuthError("Invalid token")
    jwks = _fetch_jwks()
    key = next((item for item in jwks.get("keys", []) if item.get("kid") == kid), None)
    if key is None:
        clear_jwks_cache()
        jwks = _fetch_jwks()
        key = next((item for item in jwks.get("keys", []) if item.get("kid") == kid), None)
    if key is None:
        raise AuthError("Invalid token")
    return jwt.PyJWK.from_dict(key).key


def verify_id_token(token: str) -> dict[str, Any]:
    """Return ID-token claims, or raise AuthError."""
    if not mock_enabled() and not cognito_configured():
        raise AuthError("Cognito is not configured")
    try:
        public_key = _signing_key(token)
        claims = jwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
            audience=token_audience(),
            issuer=issuer(),
            options={"require": ["exp", "sub", "aud"]},
        )
    except AuthError:
        raise
    except PyJWTError as exc:
        raise AuthError("Invalid or expired token") from exc
    except Exception as exc:
        raise AuthError("Invalid token") from exc
    if claims.get("token_use") != "id":
        raise AuthError("Invalid token")
    return claims

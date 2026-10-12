"""File-backed accounts for MARKET_SIM_AUTH=mock. Passwords never go in the clients table."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import threading
import uuid

import api.auth as auth

CONFIRM_CODE = "000000"
_lock = threading.Lock()


class MockAuthError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _users_path():
    return auth.mock_dir() / "users.json"


def _load() -> list[dict]:
    path = _users_path()
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    users = data.get("users", [])
    return users if isinstance(users, list) else []


def _save(users: list[dict]) -> None:
    path = _users_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps({"users": users}), encoding="utf-8")
    tmp.replace(path)


def _normalize(email: str) -> str:
    return email.strip().lower()


def _hash_password(password: str, salt: bytes) -> str:
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return digest.hex()


def signup(email: str, password: str) -> None:
    normalized = _normalize(email)
    if "@" not in normalized or not password:
        raise MockAuthError(400, "Email and password are required")
    with _lock:
        users = _load()
        if any(item.get("email") == normalized for item in users):
            raise MockAuthError(400, "An account with this email already exists")
        salt = os.urandom(16)
        users.append(
            {
                "email": normalized,
                "salt": salt.hex(),
                "password_hash": _hash_password(password, salt),
                "sub": str(uuid.uuid4()),
                "confirmed": False,
            }
        )
        _save(users)


def confirm(email: str, code: str) -> None:
    normalized = _normalize(email)
    if code.strip() != CONFIRM_CODE:
        raise MockAuthError(400, "Invalid code")
    with _lock:
        users = _load()
        match = next((item for item in users if item.get("email") == normalized), None)
        if match is None:
            raise MockAuthError(400, "Unknown account")
        match["confirmed"] = True
        _save(users)


def login(email: str, password: str) -> str:
    normalized = _normalize(email)
    with _lock:
        users = _load()
        match = next((item for item in users if item.get("email") == normalized), None)
        if match is None:
            raise MockAuthError(401, "Invalid email or password")
        salt = bytes.fromhex(str(match["salt"]))
        digest = _hash_password(password, salt)
        if not hmac.compare_digest(digest, str(match["password_hash"])):
            raise MockAuthError(401, "Invalid email or password")
        if not match.get("confirmed"):
            raise MockAuthError(401, "Email is not confirmed")
        sub = str(match["sub"])
    return auth.issue_mock_token(sub, normalized)

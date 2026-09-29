"""Request-scoped client identity (set by middleware / tests)."""

from __future__ import annotations

from contextvars import ContextVar

current_client_id: ContextVar[str | None] = ContextVar("current_client_id", default=None)

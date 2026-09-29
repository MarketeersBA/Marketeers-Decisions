"""Server-side session registry: one ProjectCore per browser session.

Replaces Streamlit's st.session_state.project. Single-user local scope, so
cardinality is low, but we still cap memory with idle TTL eviction.
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field

from model.project_core import ProjectCore


@dataclass
class _Session:
    project: ProjectCore
    slug: str
    last_access: float = field(default_factory=time.time)


class SessionManager:
    def __init__(self, ttl_seconds: int = 3600) -> None:
        self._ttl = ttl_seconds
        self._sessions: dict[str, _Session] = {}
        self._lock = threading.Lock()

    def create(self, slug: str, client_id: str | None = None) -> str:
        """Load a study into a fresh ProjectCore and return its session id."""
        from api.deps import resolve_client_id

        cid = client_id or resolve_client_id()
        project = ProjectCore(slug, client_id=cid)
        project.initialize()
        session_id = uuid.uuid4().hex
        with self._lock:
            self._sessions[session_id] = _Session(project=project, slug=slug)
        self._evict_expired()
        return session_id

    def get(self, session_id: str) -> ProjectCore:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise KeyError(session_id)
            session.last_access = time.time()
            return session.project

    def get_slug(self, session_id: str) -> str:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise KeyError(session_id)
            session.last_access = time.time()
            return session.slug

    def close(self, session_id: str) -> None:
        with self._lock:
            self._sessions.pop(session_id, None)

    def sync_study_display_meta(
        self, slug: str, *, price_currency_symbol: str, size_unit_label: str
    ) -> None:
        """Update display-only meta on all live sessions for this study slug."""
        with self._lock:
            for session in self._sessions.values():
                if session.slug != slug:
                    continue
                model = session.project._model
                if model and model.doc:
                    model.doc.meta.price_currency_symbol = price_currency_symbol
                    model.doc.meta.size_unit_label = size_unit_label

    def reload_study_for_slug(self, slug: str) -> None:
        """Reload study.json + HBU from storage for all sessions on this slug."""
        with self._lock:
            for session in self._sessions.values():
                if session.slug != slug:
                    continue
                session.project.initialize()

    def _evict_expired(self) -> None:
        now = time.time()
        with self._lock:
            stale = [sid for sid, s in self._sessions.items() if now - s.last_access > self._ttl]
            for sid in stale:
                self._sessions.pop(sid, None)


session_manager = SessionManager()

"""Server-side session registry: one ProjectCore per browser session.

Replaces Streamlit's st.session_state.project. Cardinality is low, but we still
cap memory with idle TTL eviction. Every session is bound to a tenant.
"""

from __future__ import annotations

from contextlib import contextmanager
import threading
import time
import uuid
from dataclasses import dataclass, field

from model.project_core import ProjectCore


@dataclass
class _Session:
    project: ProjectCore
    slug: str
    client_id: str
    last_access: float = field(default_factory=time.time)
    lock: threading.Lock = field(default_factory=threading.Lock)


class SessionManager:
    def __init__(self, ttl_seconds: int = 3600, cleanup_interval_seconds: int = 300) -> None:
        self._ttl = ttl_seconds
        self._cleanup_interval = cleanup_interval_seconds
        self._sessions: dict[str, _Session] = {}
        self._lock = threading.Lock()

        # Background cleanup thread to periodically evict expired sessions
        self._stop_event = threading.Event()
        self._cleanup_thread = threading.Thread(target=self._periodic_cleanup, daemon=True)
        self._cleanup_thread.start()

    def _periodic_cleanup(self) -> None:
        while not self._stop_event.is_set():
            time.sleep(self._cleanup_interval)
            self._evict_expired()

    def create(self, slug: str, client_id: str | None = None) -> str:
        """Load a study into a fresh ProjectCore and return its session id."""
        from api.deps import resolve_client_id

        cid = client_id or resolve_client_id()
        project = ProjectCore(slug, client_id=cid)
        project.initialize()
        session_id = uuid.uuid4().hex
        with self._lock:
            self._sessions[session_id] = _Session(project=project, slug=slug, client_id=cid)
        self._evict_expired()
        return session_id

    def _require(self, session_id: str, client_id: str) -> _Session:
        """Retrieve session while enforcing TTL expiration."""
        now = time.time()
        session = self._sessions.get(session_id)
        if session is None or session.client_id != client_id:
            raise KeyError(session_id)

        # Enforce expiry on access: if expired, evict immediately and raise
        if now - session.last_access > self._ttl:
            self._sessions.pop(session_id, None)
            raise KeyError(session_id)

        session.last_access = now
        return session

    def get(self, session_id: str, client_id: str) -> ProjectCore:
        with self._lock:
            return self._require(session_id, client_id).project

    def get_slug(self, session_id: str, client_id: str) -> str:
        with self._lock:
            return self._require(session_id, client_id).slug

    @contextmanager
    def mutate(self, session_id: str, client_id: str):
        """Context manager to serialize mutations and calculations on a session's ProjectCore."""
        with self._lock:
            session = self._require(session_id, client_id)
        with session.lock:
            yield session.project

    def close(self, session_id: str, client_id: str) -> None:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return
            if session.client_id != client_id:
                raise KeyError(session_id)
            self._sessions.pop(session_id, None)

    def sync_study_display_meta(
        self,
        client_id: str,
        slug: str,
        *,
        price_currency_symbol: str,
        size_unit_label: str,
    ) -> None:
        """Update display-only meta on live sessions for this tenant and study slug."""
        with self._lock:
            sessions = list(self._sessions.values())
        for session in sessions:
            if session.client_id != client_id or session.slug != slug:
                continue
            with session.lock:
                model = session.project._model
                if model and model.doc:
                    model.doc.meta.price_currency_symbol = price_currency_symbol
                    model.doc.meta.size_unit_label = size_unit_label

    def sync_study_identity_meta(
        self,
        client_id: str,
        slug: str,
        *,
        study_name: str,
        company_name: str,
    ) -> None:
        """Update study name/company on live sessions so lists and exports stay aligned."""
        with self._lock:
            sessions = list(self._sessions.values())
        for session in sessions:
            if session.client_id != client_id or session.slug != slug:
                continue
            with session.lock:
                model = session.project._model
                if model and model.doc:
                    model.doc.meta.study_name = study_name
                    model.doc.meta.company_name = company_name

    def reload_study_for_slug(self, client_id: str, slug: str) -> None:
        """Reload study.json + HBU from storage for this tenant's sessions on this slug."""
        with self._lock:
            sessions = list(self._sessions.values())
        for session in sessions:
            if session.client_id != client_id or session.slug != slug:
                continue
            with session.lock:
                session.project.initialize()

    def _evict_expired(self) -> None:
        now = time.time()
        with self._lock:
            stale = [sid for sid, s in self._sessions.items() if now - s.last_access > self._ttl]
            for sid in stale:
                self._sessions.pop(sid, None)


session_manager = SessionManager()

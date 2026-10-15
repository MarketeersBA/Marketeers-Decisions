"""Unit tests for SessionManager TTL enforcement, per-session locking, and cleanup."""

from __future__ import annotations

import time
import unittest
from unittest.mock import MagicMock

from api.sessions import SessionManager, _Session
from model.project_core import ProjectCore


class SessionManagerTests(unittest.TestCase):
    def test_ttl_expiry_on_access(self) -> None:
        manager = SessionManager(ttl_seconds=1, cleanup_interval_seconds=600)

        # Mock project core
        mock_project = MagicMock(spec=ProjectCore)

        session_id = "test-session-1"
        client_id = "client-1"

        manager._sessions[session_id] = _Session(
            project=mock_project,
            slug="Demo_Study",
            client_id=client_id,
            last_access=time.time() - 5.0,  # Older than TTL of 1s
        )

        with self.assertRaises(KeyError):
            manager.get(session_id, client_id)

        # Session should be removed from dictionary
        self.assertNotIn(session_id, manager._sessions)

        manager._stop_event.set()

    def test_access_valid_session_updates_time(self) -> None:
        manager = SessionManager(ttl_seconds=3600, cleanup_interval_seconds=600)
        mock_project = MagicMock(spec=ProjectCore)

        session_id = "test-session-2"
        client_id = "client-1"
        initial_time = time.time() - 10.0

        manager._sessions[session_id] = _Session(
            project=mock_project,
            slug="Demo_Study",
            client_id=client_id,
            last_access=initial_time,
        )

        project = manager.get(session_id, client_id)
        self.assertEqual(project, mock_project)
        self.assertGreater(manager._sessions[session_id].last_access, initial_time)

        manager._stop_event.set()

    def test_mutate_acquires_lock(self) -> None:
        manager = SessionManager(ttl_seconds=3600, cleanup_interval_seconds=600)
        mock_project = MagicMock(spec=ProjectCore)

        session_id = "test-session-3"
        client_id = "client-1"

        session = _Session(
            project=mock_project,
            slug="Demo_Study",
            client_id=client_id,
        )
        manager._sessions[session_id] = session

        with manager.mutate(session_id, client_id) as project:
            self.assertEqual(project, mock_project)
            # Verify session lock is locked inside context
            self.assertTrue(session.lock.locked())

        # Verify session lock is released after context
        self.assertFalse(session.lock.locked())

        manager._stop_event.set()

    def test_evict_expired(self) -> None:
        manager = SessionManager(ttl_seconds=1, cleanup_interval_seconds=600)
        mock_project = MagicMock(spec=ProjectCore)

        manager._sessions["s1"] = _Session(
            project=mock_project,
            slug="Demo_Study",
            client_id="c1",
            last_access=time.time() - 10.0,
        )
        manager._sessions["s2"] = _Session(
            project=mock_project,
            slug="Demo_Study",
            client_id="c1",
            last_access=time.time(),
        )

        manager._evict_expired()

        self.assertNotIn("s1", manager._sessions)
        self.assertIn("s2", manager._sessions)

        manager._stop_event.set()

    def test_sync_study_identity_meta(self) -> None:
        manager = SessionManager(ttl_seconds=3600, cleanup_interval_seconds=600)
        mock_meta = MagicMock()
        mock_meta.study_name = "Old"
        mock_meta.company_name = "Old Co"
        mock_project = MagicMock()
        mock_project._model.doc.meta = mock_meta

        manager._sessions["s1"] = _Session(
            project=mock_project,
            slug="Launch_Study",
            client_id="c1",
        )
        other_meta = MagicMock()
        other_meta.study_name = "Other"
        other = MagicMock()
        other._model.doc.meta = other_meta
        manager._sessions["s2"] = _Session(
            project=other,
            slug="Other",
            client_id="c1",
        )

        manager.sync_study_identity_meta(
            "c1",
            "Launch_Study",
            study_name="New Name",
            company_name="New Co",
        )

        self.assertEqual(mock_meta.study_name, "New Name")
        self.assertEqual(mock_meta.company_name, "New Co")
        self.assertEqual(other_meta.study_name, "Other")

        manager._stop_event.set()

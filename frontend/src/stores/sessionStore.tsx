import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { api } from "../api/client";
import type { SessionPayload } from "../api/types";
import { useAuth } from "../auth/AuthProvider";

const SESSION_STORAGE_KEY = "ms_session_id";

interface SessionState {
  session: SessionPayload | null;
  restoring: boolean;
  setSession: (s: SessionPayload | null) => void;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { ready, mode, signedIn } = useAuth();
  const [session, setSessionState] = useState<SessionPayload | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    if (!ready) return;
    if ((mode === "cognito" || mode === "mock") && !signedIn) {
      setRestoring(false);
      return;
    }
    const sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!sessionId) {
      setRestoring(false);
      return;
    }

    let cancelled = false;
    api
      .post<SessionPayload>(`/api/sessions/${sessionId}/recalculate`, { changes: [] })
      .then((payload) => {
        if (!cancelled) setSessionState(payload);
      })
      .catch(() => {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ready, mode, signedIn]);

  const setSession = useCallback((next: SessionPayload | null) => {
    setSessionState(next);
    if (next?.sessionId) {
      sessionStorage.setItem(SESSION_STORAGE_KEY, next.sessionId);
    } else {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, []);

  const value = useMemo(
    () => ({ session, restoring, setSession }),
    [session, restoring, setSession],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}

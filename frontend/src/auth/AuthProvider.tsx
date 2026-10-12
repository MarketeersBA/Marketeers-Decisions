import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { restoreMockToken, setMockToken, setUnauthorizedHandler } from "./token";

export type AuthMode = "dev" | "cognito" | "mock";

type AuthConfig =
  | { mode: "dev" }
  | { mode: "mock" }
  | { mode: "cognito"; region: string; userPoolId: string; clientId: string };

type AuthState = {
  ready: boolean;
  mode: AuthMode;
  signedIn: boolean;
  completeSignIn: () => void;
  signOut: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<AuthMode>("dev");
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/config");
        const config = (await res.json()) as AuthConfig;
        if (cancelled) return;
        if (config.mode === "cognito") {
          setMode("cognito");
          const cognito = await import("./cognito");
          cognito.initCognito(config.userPoolId, config.clientId);
          const token = await cognito.restoreSession();
          if (!cancelled) setSignedIn(Boolean(token));
        } else if (config.mode === "mock") {
          setMode("mock");
          if (!cancelled) setSignedIn(Boolean(restoreMockToken()));
        } else {
          setMode("dev");
          setSignedIn(true);
        }
      } catch {
        if (!cancelled) {
          setMode("dev");
          setSignedIn(true);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const completeSignIn = useCallback(() => setSignedIn(true), []);

  const signOut = useCallback(() => {
    void (async () => {
      if (mode === "cognito") {
        const cognito = await import("./cognito");
        cognito.signOut();
      }
      setMockToken(null);
      setSignedIn(false);
      window.location.assign("/login");
    })();
  }, [mode]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      signOut();
    });
  }, [signOut]);

  const value = useMemo(
    () => ({ ready, mode, signedIn, completeSignIn, signOut }),
    [ready, mode, signedIn, completeSignIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

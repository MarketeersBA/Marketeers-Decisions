import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import logoMark from "../assets/logo-mark.png";
import { PageLoading } from "../components/PageLoading";
import "./auth.css";

function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8.2" r="3.15" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M5.4 19.2c1.35-2.85 3.55-4.25 6.6-4.25s5.25 1.4 6.6 4.25"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5.2" y="10.4" width="13.6" height="9.1" rx="2.1" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M8.4 10.4V8.1a3.6 3.6 0 0 1 7.2 0v2.3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LoginPage() {
  const { ready, mode, signedIn, completeSignIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!ready) return <PageLoading label="Checking sign-in…" />;
  if (mode === "dev" || signedIn) return <Navigate to="/" replace />;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "mock") {
        const { signIn } = await import("../auth/mock");
        await signIn(email, password);
      } else {
        const { signIn } = await import("../auth/cognito");
        await signIn(email, password);
      }
      completeSignIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page auth-page--login">
      <form className="auth-card auth-card--login" onSubmit={onSubmit}>
        <div className="login-mark">
          <img src={logoMark} alt="Marketeers" />
        </div>
        <h1 className="login-title">
          Welcome <em>Back</em>
        </h1>
        <p className="login-sub">Access your pricing simulator</p>
        {error ? <p className="auth-error">{error}</p> : null}
        <label className="login-label">
          Email
          <span className="login-field">
            <UserIcon />
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </span>
        </label>
        <label className="login-label">
          Password
          <span className="login-field">
            <LockIcon />
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </span>
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { PageLoading } from "../components/PageLoading";
import "./auth.css";

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
    <div className="auth-page">
      <form className="auth-card" onSubmit={onSubmit}>
        <h1>Sign in</h1>
        {error ? <p className="auth-error">{error}</p> : null}
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="auth-links">
          No account? <Link to="/signup">Create one</Link>
        </p>
      </form>
    </div>
  );
}

import { useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { PageLoading } from "../components/PageLoading";
import "./auth.css";

export function ConfirmPage() {
  const { ready, mode, signedIn } = useAuth();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!ready) return <PageLoading label="Checking sign-in…" />;
  if (mode === "dev" || signedIn) return <Navigate to="/" replace />;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "mock") {
        const { confirmSignUp } = await import("../auth/mock");
        await confirmSignUp(email, code);
      } else {
        const { confirmSignUp } = await import("../auth/cognito");
        await confirmSignUp(email, code);
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirmation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={onSubmit}>
        <h1>Confirm email</h1>
        {mode === "mock" ? <p>Development code: 000000</p> : null}
        {error ? <p className="auth-error">{error}</p> : null}
        {done ? <p>Email confirmed. You can sign in.</p> : null}
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
          Code
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={busy || done}>
          {busy ? "Confirming…" : "Confirm"}
        </button>
        <p className="auth-links">
          <Link to="/login">Back to sign in</Link>
        </p>
      </form>
    </div>
  );
}

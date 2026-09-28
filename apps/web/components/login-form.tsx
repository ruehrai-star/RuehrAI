"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api";
import { useSession } from "./session-provider";

export function LoginForm() {
  const router = useRouter();
  const { session, login, logout } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await login(email, password);
      router.push("/");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Anmeldung fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  async function onLogout() {
    setPending(true);
    try {
      await logout();
    } finally {
      setPending(false);
    }
  }

  if (session) {
    return (
      <div className="auth-card">
        <p className="stub-kicker">Backend-Session</p>
        <h2>Angemeldet</h2>
        <p className="stub-copy">
          {session.email} · gültig bis {new Date(session.expiresAt).toLocaleString("de-DE")}
        </p>
        <p className="token" title={session.accessToken}>
          {session.tokenType} {session.accessToken.slice(0, 28)}…
        </p>
        <p className="hint">
          JWT aus <code>POST /auth/login</code>. Es liegt nur in <code>sessionStorage</code> und geht
          mit <code>Authorization: Bearer</code> an Suche und Lagen.
        </p>
        <div className="auth-actions">
          <button type="button" className="button" onClick={() => router.push("/")}>
            Zur Karte
          </button>
          <button type="button" className="button button-quiet" onClick={onLogout} disabled={pending}>
            Abmelden
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="auth-card" onSubmit={onSubmit}>
      <p className="stub-kicker">POST /auth/login</p>
      <h2>Beim Backend anmelden</h2>
      <p className="stub-copy">
        Das Backend stellt das JWT aus. Lokal ist der Seed-Account{" "}
        <code>dev@ruehrai.local</code> / <code>dev-password</code>. Passwort mindestens 8 Zeichen.
      </p>
      <label htmlFor="login-email">E-Mail</label>
      <input
        id="login-email"
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <label htmlFor="login-password">Passwort</label>
      <input
        id="login-password"
        type="password"
        autoComplete="current-password"
        required
        minLength={8}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      {error ? <p className="message message-error">{error}</p> : null}
      <button type="submit" className="button" disabled={pending}>
        {pending ? "Anmeldung …" : "Anmelden"}
      </button>
    </form>
  );
}

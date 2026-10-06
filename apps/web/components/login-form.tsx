"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { resolveSignedInEntryHref } from "@/lib/entry";
import { getLocationApi } from "@/lib/locations/api";
import { LOGIN_EXPIRED_COPY } from "@/lib/session-storage";
import { authErrorMessage } from "@/lib/user-message";
import { useSession } from "./session-provider";
import { SignedInPanel } from "./signed-in-panel";

export function LoginForm({ expired = false }: { expired?: boolean }) {
  const router = useRouter();
  const { session, login } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await login(email.trim(), password);
      router.push(await resolveSignedInEntryHref(getLocationApi()));
    } catch (caught) {
      setError(authErrorMessage(caught, "login"));
    } finally {
      setPending(false);
    }
  }

  if (session) {
    return (
      <>
        <p className="stub-kicker">Konto</p>
        <h1>Angemeldet</h1>
        <SignedInPanel />
      </>
    );
  }

  return (
    <>
      <p className="stub-kicker">Konto</p>
      <h1>Anmelden</h1>
      {expired ? (
        <p className="message" role="status">
          {LOGIN_EXPIRED_COPY}
        </p>
      ) : null}
      <form className="auth-card" onSubmit={onSubmit}>
        <p className="stub-copy">Mit E-Mail und Passwort anmelden. Danach öffnet sich der Verlauf, ohne Standorte die Eingabe.</p>
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
        <p className="hint">Mindestens 8 Zeichen. Lokal: dev@ruehrai.local / dev-password.</p>
        {error ? (
          <p className="message message-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="button" disabled={pending}>
          {pending ? "Anmelden …" : "Anmelden"}
        </button>
        <p className="auth-switch">
          Noch kein Konto? <Link href="/register">Registrieren</Link>
        </p>
      </form>
    </>
  );
}

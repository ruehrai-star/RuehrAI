"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authErrorMessage } from "@/lib/user-message";
import { useSession } from "./session-provider";
import { SignedInPanel } from "./signed-in-panel";

export function RegisterForm() {
  const router = useRouter();
  const { session, register } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirm) {
      setError("Die Passwörter stimmen nicht überein.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await register(email.trim(), password);
      router.push("/");
    } catch (caught) {
      setError(authErrorMessage(caught, "register"));
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
      <h1>Registrieren</h1>
      <form className="auth-card" onSubmit={onSubmit}>
        <p className="stub-copy">Neues Konto anlegen. Danach ist das Konto angemeldet und die Karte öffnet sich.</p>
        <label htmlFor="register-email">E-Mail</label>
        <input
          id="register-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <label htmlFor="register-password">Passwort</label>
        <input
          id="register-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <label htmlFor="register-confirm">Passwort wiederholen</label>
        <input
          id="register-confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
        <p className="hint">Mindestens 8 Zeichen.</p>
        {error ? (
          <p className="message message-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="button" disabled={pending}>
          {pending ? "Registrieren …" : "Registrieren"}
        </button>
        <p className="auth-switch">
          Schon ein Konto? <Link href="/login">Anmelden</Link>
        </p>
      </form>
    </>
  );
}

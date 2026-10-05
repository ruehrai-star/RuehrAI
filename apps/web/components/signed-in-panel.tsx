"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "./session-provider";

export function SignedInPanel() {
  const router = useRouter();
  const { session, logout } = useSession();
  const [pending, setPending] = useState(false);
  if (!session) return null;

  async function onLogout() {
    setPending(true);
    try {
      await logout();
    } finally {
      setPending(false);
      router.push("/login");
    }
  }

  return (
    <div className="auth-card">
      <p className="stub-copy">{session.email}</p>
      <p className="hint">Abmelden beendet die Sitzung in diesem Browser.</p>
      <div className="auth-actions">
        <button type="button" className="button" onClick={() => router.push("/verlauf")}>
          Zum Verlauf
        </button>
        <Link href="/standorte" className="button button-quiet">
          Standorte
        </Link>
        <button type="button" className="button button-quiet" onClick={() => router.push("/")}>
          Zur Karte
        </button>
        <button type="button" className="button button-quiet" onClick={onLogout} disabled={pending}>
          {pending ? "Abmelden …" : "Abmelden"}
        </button>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "./session-provider";

export function SignedInPanel() {
  const router = useRouter();
  const { session, logout } = useSession();
  if (!session) return null;

  function onLogout() {
    logout();
    router.push("/login");
  }

  return (
    <div className="auth-card">
      <p className="stub-copy">{session.email}</p>
      <p className="hint">Abmelden beendet die Sitzung in diesem Browser.</p>
      <div className="auth-actions">
        <button type="button" className="button" onClick={() => router.push("/")}>
          Zur Karte
        </button>
        <Link href="/standorte" className="button button-quiet">
          Standorte
        </Link>
        <button type="button" className="button button-quiet" onClick={onLogout}>
          Abmelden
        </button>
      </div>
    </div>
  );
}

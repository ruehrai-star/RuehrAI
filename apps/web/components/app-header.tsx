"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "./session-provider";

const LINKS: { href: string; label: string; signedIn?: boolean }[] = [
  { href: "/verlauf", label: "Verlauf", signedIn: true },
  { href: "/standorte", label: "Standorte", signedIn: true },
  { href: "/", label: "Karte" },
  { href: "/empfehlungen", label: "Empfehlungen", signedIn: true },
  { href: "/adressen", label: "Adressen", signedIn: true },
  { href: "/musteranalyse", label: "Musteranalyse", signedIn: true },
  { href: "/dashboard", label: "Übersicht" },
  { href: "/onboarding", label: "Einstieg" },
];

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { session, logout } = useSession();
  const [pending, setPending] = useState(false);

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
    <header className="topbar">
      <a className="skip-link" href="#inhalt">
        Zum Inhalt
      </a>
      <Link href="/" className="brand">
        <span className="brand-mark" aria-hidden="true">
          R
        </span>
        <span className="brand-text">
          <span className="brand-name">RuehrAI</span>
          <span className="brand-tag">Standortberatung</span>
        </span>
      </Link>
      <nav className="nav" aria-label="Hauptnavigation">
        {LINKS.filter((link) => !link.signedIn || session).map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={active ? "nav-link is-active" : "nav-link"}
              aria-current={active ? "page" : undefined}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
      <div className="account">
        {session ? (
          <>
            <span className="account-email" title={session.email}>
              {session.email}
            </span>
            <button type="button" className="button button-quiet" onClick={onLogout} disabled={pending}>
              {pending ? "Abmelden …" : "Abmelden"}
            </button>
          </>
        ) : (
          <Link href="/login" className="button">
            Anmelden
          </Link>
        )}
      </div>
    </header>
  );
}

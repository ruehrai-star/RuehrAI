import Link from "next/link";
import type { ReactNode } from "react";

interface PlaceholderPageProps {
  kicker: string;
  title: string;
  children: ReactNode;
}

export function PlaceholderPage({ kicker, title, children }: PlaceholderPageProps) {
  return (
    <main className="stub" id="inhalt">
      <p className="stub-kicker">{kicker}</p>
      <h1>{title}</h1>
      <div className="stub-copy">{children}</div>
      <Link href="/" className="button">
        Zur Karte
      </Link>
    </main>
  );
}

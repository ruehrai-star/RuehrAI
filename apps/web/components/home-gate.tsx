"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ENTRY_COPY, MAP_HREF, resolveSignedInEntryHref } from "@/lib/entry";
import { getLocationApi } from "@/lib/locations/api";
import { useSession } from "./session-provider";

export function HomeGate() {
  const router = useRouter();
  const { session } = useSession();

  useEffect(() => {
    if (!session) {
      router.replace(MAP_HREF);
      return;
    }
    let cancelled = false;
    void resolveSignedInEntryHref(getLocationApi()).then((href) => {
      if (!cancelled) router.replace(href);
    });
    return () => {
      cancelled = true;
    };
  }, [session, router]);

  return (
    <main className="stub" id="inhalt">
      <p className="stub-kicker">RuehrAI</p>
      <h1>{ENTRY_COPY.redirecting}</h1>
    </main>
  );
}

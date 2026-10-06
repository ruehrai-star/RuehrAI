"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { TargetRegion } from "@/lib/api";
import { persistedMarkedKey, readMarkedKey, subscribeMarkedKey, writeMarkedKey } from "@/lib/locations/marked-region";

export function usePersistedMarkedKey(
  items: readonly TargetRegion[],
): [string | null, (key: string | null) => void] {
  const stored = useSyncExternalStore(subscribeMarkedKey, readMarkedKey, () => null);
  const key = persistedMarkedKey(items, stored);
  useEffect(() => {
    if (key && key !== stored) writeMarkedKey(key);
  }, [key, stored]);
  return [key, writeMarkedKey];
}
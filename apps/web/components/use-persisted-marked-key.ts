"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { TargetRegion } from "@/lib/api";
import {
  clearMarkedKey,
  isUnresolvedMarkedKey,
  persistedMarkedKey,
  readMarkedKey,
  subscribeMarkedKey,
  writeMarkedKey,
} from "@/lib/locations/marked-region";

export function usePersistedMarkedKey(
  items: readonly TargetRegion[],
): [string | null, (key: string | null) => void, boolean] {
  const stored = useSyncExternalStore(subscribeMarkedKey, readMarkedKey, () => null);
  const key = persistedMarkedKey(items, stored);
  const missing = isUnresolvedMarkedKey(items, stored);
  useEffect(() => {
    if (missing) {
      if (stored) clearMarkedKey();
      return;
    }
    if (key && key !== stored) writeMarkedKey(key);
  }, [missing, key, stored]);
  return [key, writeMarkedKey, missing];
}

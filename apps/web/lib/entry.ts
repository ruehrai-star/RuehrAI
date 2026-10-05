import type { RuehrApi } from "./api/client.ts";
import { POST_STANDORTE_HREF } from "./verlauf/model.ts";

/** Map stays in the nav; it is no longer the signed-in entry. */
export const MAP_HREF = "/karte";

/** Empty accounts start at Standort-Eingabe. */
export const STANDORTE_HREF = "/standorte";

/** Vorschlag 2: after locations exist, the product opens Verlauf. */
export const VERLAUF_HREF = POST_STANDORTE_HREF;

export const ENTRY_COPY = {
  redirecting: "Weiterleitung …",
} as const;

/**
 * Saved Standort-Eingaben: Filialadressen (`GET /stores`) or Zielregionen
 * (`GET /target-region`). Either is enough to open Verlauf.
 */
export function hasSavedLocations(
  stores: { length: number },
  regions: { length: number } = { length: 0 },
): boolean {
  return stores.length > 0 || regions.length > 0;
}

/** Signed-in `/` and post-login destination. Guests are not handled here. */
export function signedInEntryHref(hasLocations: boolean): string {
  return hasLocations ? VERLAUF_HREF : STANDORTE_HREF;
}

export async function resolveSignedInEntryHref(
  api: Pick<RuehrApi, "listStores" | "listTargetRegions">,
): Promise<string> {
  try {
    const [stores, regions] = await Promise.all([api.listStores(), api.listTargetRegions()]);
    return signedInEntryHref(hasSavedLocations(stores, regions));
  } catch {
    return VERLAUF_HREF;
  }
}

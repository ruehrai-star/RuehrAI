import { AnalysisInput, AnalysisStoreInput, BrainFact } from "./types";

/**
 * Facts from Bestandstandort surroundings (store PLZ / extra AGS keys),
 * never the Zielregion unless that key also belongs to a store.
 */
export function factsMatchingStoreSurroundings(
  input: AnalysisInput,
  facts: BrainFact[],
  extraKeys: readonly string[] = [],
): BrainFact[] {
  const keys = storeSurroundingKeys(input.stores, extraKeys);
  if (keys.size === 0) return [];
  return facts.filter((fact) => fact.matchedBy === "store" || keys.has(normalizeKey(fact.geoKey)));
}

export function storeSurroundingKeys(
  stores: AnalysisStoreInput[],
  extraKeys: readonly string[] = [],
): Set<string> {
  const keys = new Set<string>();
  for (const store of stores) {
    const plz = store.postalCode?.trim();
    if (plz && /^[0-9]{5}$/.test(plz)) {
      keys.add(plz);
      keys.add(`plz5:${plz}`);
      keys.add(`plz8:${plz}`);
    }
  }
  for (const key of extraKeys) {
    const trimmed = key.trim();
    if (!trimmed) continue;
    keys.add(trimmed);
    keys.add(normalizeKey(trimmed));
  }
  return keys;
}

function normalizeKey(value: string): string {
  return value.trim().replace(/^(?:plz5|plz8):/i, "");
}

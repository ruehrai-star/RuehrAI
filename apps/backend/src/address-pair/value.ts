const GEBAEUDE_KEYS = ["gebaeude", "gebäude", "Gebäude", "buildings"] as const;
const WOHNUNGEN_KEYS = ["wohnungen", "Wohnungen", "dwellings"] as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Drop null/undefined keys. Keep a stored 0 — that is a real cell, not a substitute. */
export function storedRowValue(metadata: unknown): unknown {
  if (!isRecord(metadata)) return metadata ?? {};
  return omitEmptyKeys(metadata);
}

function omitEmptyKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined || value === null) continue;
    out[key] = value;
  }
  return out;
}

export function pickPresentCell(value: unknown, keys: readonly string[]): { key: string; value: unknown } | null {
  if (!isRecord(value)) return null;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const cell = value[key];
    if (cell === undefined || cell === null) continue;
    return { key, value: cell };
  }
  return null;
}

/**
 * Merge the three Zensus feature-docs that already exist on Brain.
 * `gebaeude` / `wohnungen` appear only when that cell is on a stored row.
 */
export function zensus2022Value(rows: readonly unknown[]): unknown | undefined {
  if (rows.length === 0) return undefined;
  const merged: Record<string, unknown> = {};
  for (const row of rows) {
    if (!isRecord(row)) continue;
    Object.assign(merged, omitEmptyKeys(row));
  }
  const gebaeude = rows.map((row) => pickPresentCell(row, GEBAEUDE_KEYS)).find(Boolean);
  const wohnungen = rows.map((row) => pickPresentCell(row, WOHNUNGEN_KEYS)).find(Boolean);
  for (const key of [...GEBAEUDE_KEYS, ...WOHNUNGEN_KEYS]) {
    delete merged[key];
  }
  if (gebaeude) merged[gebaeude.key] = gebaeude.value;
  if (wohnungen) merged[wohnungen.key] = wohnungen.value;
  return merged;
}

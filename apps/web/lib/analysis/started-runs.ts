const STORAGE_KEY = "ruehrai.startedAnalysisRuns";

/**
 * Client memory of which Musteranalyse run the user started for a Zielregion.
 * POST /analysis/runs still snapshots every saved region (backend ignores
 * `?geoKey=` today). This map keeps Variante A from treating that snapshot
 * as another region's own run.
 */

function readMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key === "string" && key.trim() && typeof value === "string" && value.trim()) {
        out[key.trim()] = value.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, string>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function rememberStartedRun(geoKey: string, runId: string): void {
  const key = geoKey.trim();
  const id = runId.trim();
  if (!key || !id) return;
  writeMap({ ...readMap(), [key]: id });
}

export function startedRunIdForRegion(geoKey: string | null | undefined): string | null {
  if (typeof geoKey !== "string") return null;
  const key = geoKey.trim();
  if (!key) return null;
  return readMap()[key] ?? null;
}

export function parseStartedRunMap(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key === "string" && key.trim() && typeof value === "string" && value.trim()) {
        out[key.trim()] = value.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

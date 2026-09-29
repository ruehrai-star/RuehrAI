/** Representative WGS84 point for a contract geometry (lon, lat). */
export function pointFromGeometry(geometry: {
  type: string;
  coordinates: unknown;
}): { lon: number; lat: number } | null {
  if (geometry.type === "Point") {
    return position(geometry.coordinates);
  }
  if (geometry.type === "Polygon") {
    return ringCentroid(firstRing(geometry.coordinates));
  }
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return ringCentroid(firstRing(geometry.coordinates[0]));
  }
  return null;
}

/**
 * Usable WGS84 pair. Finite numbers are kept. Numeric strings from JSON are
 * kept too; null, blank, and non-numeric values are not a pin.
 */
export function coordinatesOf(value: {
  lon?: unknown;
  lat?: unknown;
}): { lon: number; lat: number } | null {
  const lon = finiteCoord(value.lon);
  const lat = finiteCoord(value.lat);
  if (lon === null || lat === null) return null;
  return { lon, lat };
}

function finiteCoord(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
}

function position(value: unknown): { lon: number; lat: number } | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lon = value[0];
  const lat = value[1];
  if (typeof lon !== "number" || typeof lat !== "number") return null;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lon, lat };
}

function firstRing(value: unknown): unknown[] | null {
  if (!Array.isArray(value) || !Array.isArray(value[0])) return null;
  return value[0] as unknown[];
}

function ringCentroid(ring: unknown[] | null): { lon: number; lat: number } | null {
  if (!ring || ring.length === 0) return null;
  const positions = ring
    .map((entry) => position(entry))
    .filter((entry): entry is { lon: number; lat: number } => entry !== null);
  if (positions.length === 0) return null;
  const first = positions[0];
  const last = positions[positions.length - 1];
  const open =
    positions.length > 1 && first && last && first.lon === last.lon && first.lat === last.lat
      ? positions.slice(0, -1)
      : positions;
  const used = open.length > 0 ? open : positions;
  const lon = used.reduce((sum, entry) => sum + entry.lon, 0) / used.length;
  const lat = used.reduce((sum, entry) => sum + entry.lat, 0) / used.length;
  return { lon, lat };
}

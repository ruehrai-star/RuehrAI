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

export function coordinatesOf(value: {
  lon?: number | null;
  lat?: number | null;
}): { lon: number; lat: number } | null {
  if (typeof value.lon !== "number" || typeof value.lat !== "number") return null;
  if (!Number.isFinite(value.lon) || !Number.isFinite(value.lat)) return null;
  return { lon: value.lon, lat: value.lat };
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

/** About 11 m. Stored PLZ stubs and the centroid they were copied from stay inside this. */
export const PLZ_PIN_EPSILON = 0.0001;

export interface PinPoint {
  lon: number;
  lat: number;
}

export interface StoredPin {
  lon: number | null;
  lat: number | null;
}

export function samePin(
  stored: StoredPin,
  point: PinPoint | null | undefined,
): boolean {
  if (!point || stored.lon === null || stored.lat === null) return false;
  return (
    Math.abs(stored.lon - point.lon) < PLZ_PIN_EPSILON &&
    Math.abs(stored.lat - point.lat) < PLZ_PIN_EPSILON
  );
}

/**
 * Address hit replaces a null pin or a pin that still sits on a PLZ centroid.
 * A null pin with no address hit takes the first PLZ centroid. An explicit
 * pin that is not a centroid is left alone.
 */
export function nextStoredPin(input: {
  stored: StoredPin;
  address: PinPoint | null;
  plzCentroids: Array<PinPoint | null | undefined>;
}): { point: PinPoint; source: "address" | "plz" } | null {
  const centroids = input.plzCentroids.filter((point): point is PinPoint => point != null);
  const missing = input.stored.lon === null || input.stored.lat === null;
  if (
    input.address &&
    (missing || centroids.some((point) => samePin(input.stored, point))) &&
    !samePin(input.stored, input.address)
  ) {
    return { point: input.address, source: "address" };
  }
  if (missing) {
    const plz = centroids[0];
    if (plz) return { point: plz, source: "plz" };
  }
  return null;
}

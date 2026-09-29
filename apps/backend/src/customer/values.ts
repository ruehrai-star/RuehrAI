import { BadRequestException } from "@nestjs/common";

export function normalizeCoordPair(
  lon: number | null | undefined,
  lat: number | null | undefined,
): { lon: number | null; lat: number | null } {
  const hasLon = typeof lon === "number";
  const hasLat = typeof lat === "number";
  if (hasLon !== hasLat) {
    throw new BadRequestException("lon and lat must both be set or both be empty");
  }
  return {
    lon: hasLon ? lon : null,
    lat: hasLat ? lat : null,
  };
}

export function toCoord(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Persist EUR with two decimal places. Null marks the month as missing. */
export function toRevenueParam(value: number | null): string | null {
  if (value === null) return null;
  return value.toFixed(2);
}

export function toRevenue(value: string | number | null): number | null {
  if (value === null) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error("Invalid revenue_eur");
  }
  return numeric;
}

export function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

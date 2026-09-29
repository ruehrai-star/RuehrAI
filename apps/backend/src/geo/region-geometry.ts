import { BadRequestException } from "@nestjs/common";
import { toCoord } from "../customer/values";

/** WGS84 extent. `west`/`east` are longitudes, `south`/`north` are latitudes. */
export interface LonLatBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface RegionPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

export interface RegionMultiPolygon {
  type: "MultiPolygon";
  coordinates: number[][][][];
}

export type RegionGeometry = RegionPolygon | RegionMultiPolygon;

export interface LonLat {
  lon: number;
  lat: number;
}

const RING_ERROR = "geometry rings must be closed and contain at least four positions";
const TYPE_ERROR = "geometry must be a GeoJSON Polygon or MultiPolygon";
const COORD_ERROR = "geometry coordinates must be WGS84 longitude and latitude";

/** Half-size in degrees for a synthetic outline around a catalog point. */
const STUB_HALF: Record<string, readonly [number, number]> = {
  ags: [0.18, 0.095],
  ags5: [0.08, 0.05],
  plz5: [0.02, 0.012],
  plz8: [0.004, 0.0025],
  grid100: [0.00045, 0.00045],
  address: [0.0012, 0.0008],
  other: [0.05, 0.03],
};

export function parseRegionGeometry(value: unknown): RegionGeometry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(TYPE_ERROR);
  }
  const record = value as { type?: unknown; coordinates?: unknown };
  if (record.type !== "Polygon" && record.type !== "MultiPolygon") {
    throw new BadRequestException(TYPE_ERROR);
  }
  if (!Array.isArray(record.coordinates)) {
    throw new BadRequestException(TYPE_ERROR);
  }
  if (record.type === "Polygon") {
    return { type: "Polygon", coordinates: parsePolygons([record.coordinates])[0]! };
  }
  if (record.coordinates.length === 0) {
    throw new BadRequestException(TYPE_ERROR);
  }
  return { type: "MultiPolygon", coordinates: parsePolygons(record.coordinates) };
}

export function geometryFromUnknown(value: unknown): RegionGeometry | null {
  if (value == null) return null;
  try {
    return parseRegionGeometry(value);
  } catch {
    return null;
  }
}

export function parseBounds(value: {
  west: number;
  south: number;
  east: number;
  north: number;
}): LonLatBounds {
  const { west, south, east, north } = value;
  if (west > east) {
    throw new BadRequestException("bounds.west must be less than or equal to bounds.east");
  }
  if (south > north) {
    throw new BadRequestException("bounds.south must be less than or equal to bounds.north");
  }
  return { west, south, east, north };
}

export function boundsFromGeometry(geometry: RegionGeometry): LonLatBounds {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  eachPosition(geometry, (lon, lat) => {
    west = Math.min(west, lon);
    south = Math.min(south, lat);
    east = Math.max(east, lon);
    north = Math.max(north, lat);
  });
  return { west, south, east, north };
}

export function polygonFromBounds(bounds: LonLatBounds): RegionPolygon {
  const { west, south, east, north } = bounds;
  return {
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}

/** Closed rectangle around a point. Same stub family as `app.map_features`, not an official boundary. */
export function stubPolygon(lon: number, lat: number, grain: string | null): RegionPolygon {
  const [halfLon, halfLat] = STUB_HALF[grain ?? "other"] ?? STUB_HALF.other!;
  return polygonFromBounds({
    west: clamp(lon - halfLon, -180, 180),
    south: clamp(lat - halfLat, -90, 90),
    east: clamp(lon + halfLon, -180, 180),
    north: clamp(lat + halfLat, -90, 90),
  });
}

export function centroid(geometry: RegionGeometry): LonLat {
  const ring =
    geometry.type === "Polygon" ? geometry.coordinates[0] : geometry.coordinates[0]?.[0];
  if (!ring || ring.length === 0) {
    throw new BadRequestException(TYPE_ERROR);
  }
  const unique =
    ring.length > 1 && samePosition(ring[0]!, ring[ring.length - 1]!) ? ring.slice(0, -1) : ring;
  const lon = unique.reduce((sum, position) => sum + position[0]!, 0) / unique.length;
  const lat = unique.reduce((sum, position) => sum + position[1]!, 0) / unique.length;
  return { lon, lat };
}

export interface RegionMapInput {
  grain: string | null;
  lon: number | null;
  lat: number | null;
  bounds: LonLatBounds | null;
  geometry: RegionGeometry | null;
  catalogGeometry: RegionGeometry | null;
  catalogPoint: LonLat | null;
}

export interface RegionMap {
  lon: number | null;
  lat: number | null;
  bounds: LonLatBounds | null;
  geometry: RegionGeometry | null;
}

/**
 * Client geometry wins, and its centroid fills a missing point.
 * Client bounds become a rectangular polygon. Otherwise a catalog
 * Polygon/MultiPolygon is used (point from the catalog, then the centroid),
 * or a stub rectangle around the catalog point.
 */
export function resolveRegionMap(input: RegionMapInput): RegionMap {
  let geometry = input.geometry;
  let bounds = input.bounds;
  let lon = input.lon;
  let lat = input.lat;

  if (geometry) {
    bounds = boundsFromGeometry(geometry);
  } else if (bounds) {
    geometry = polygonFromBounds(bounds);
  } else if (input.catalogGeometry) {
    geometry = input.catalogGeometry;
    bounds = boundsFromGeometry(geometry);
  }

  if (lon === null || lat === null) {
    if (input.catalogPoint && !input.geometry) {
      lon = input.catalogPoint.lon;
      lat = input.catalogPoint.lat;
    } else if (geometry) {
      const point = centroid(geometry);
      lon = point.lon;
      lat = point.lat;
    }
  }

  if (!geometry && lon !== null && lat !== null) {
    geometry = stubPolygon(lon, lat, input.grain);
    bounds = boundsFromGeometry(geometry);
  }

  return { lon, lat, bounds, geometry };
}

export function boundsFromRow(row: {
  bounds_west?: number | string | null;
  bounds_south?: number | string | null;
  bounds_east?: number | string | null;
  bounds_north?: number | string | null;
}): LonLatBounds | null {
  const west = toCoord(row.bounds_west);
  const south = toCoord(row.bounds_south);
  const east = toCoord(row.bounds_east);
  const north = toCoord(row.bounds_north);
  if (west === null || south === null || east === null || north === null) return null;
  if (west > east || south > north) return null;
  return { west, south, east, north };
}

function parsePolygons(polygons: unknown[]): number[][][][] {
  return polygons.map((polygon) => {
    if (!Array.isArray(polygon) || polygon.length === 0) {
      throw new BadRequestException(RING_ERROR);
    }
    return polygon.map((ring) => parseRing(ring));
  });
}

function parseRing(value: unknown): number[][] {
  if (!Array.isArray(value) || value.length < 4) {
    throw new BadRequestException(RING_ERROR);
  }
  const ring = value.map((position) => parsePosition(position));
  if (!samePosition(ring[0]!, ring[ring.length - 1]!)) {
    throw new BadRequestException(RING_ERROR);
  }
  return ring;
}

function parsePosition(value: unknown): number[] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new BadRequestException(COORD_ERROR);
  }
  const lon = value[0];
  const lat = value[1];
  if (typeof lon !== "number" || typeof lat !== "number" || !Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new BadRequestException(COORD_ERROR);
  }
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    throw new BadRequestException(COORD_ERROR);
  }
  return [lon, lat];
}

function eachPosition(geometry: RegionGeometry, visit: (lon: number, lat: number) => void): void {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const position of ring) {
        visit(position[0]!, position[1]!);
      }
    }
  }
}

function samePosition(left: number[], right: number[]): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

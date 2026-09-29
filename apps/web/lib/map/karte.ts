import type { Recommendation, RegionGeometry, StoreLocation, TargetRegion } from "@ruehrai/api-contracts";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import { coordinatesOf } from "../api/geo.ts";

/**
 * Map model for the Karte page (KAN-48, KAN-50, KAN-51) on OpenAPI 0.5.0.
 *
 * Pins use `StoreLocation.lon` / `lat` from `GET /stores` (WGS84). The Backend
 * fills a missing pair from the PLZ centroid. Null stays unpinned.
 *
 * `GET` / `PUT /target-region` returns:
 * - `bounds`: `LonLatBounds` `{ west, south, east, north }` for fitBounds
 * - `geometry`: GeoJSON Polygon or MultiPolygon for the colored overlay
 *
 * Both are null when the region has no outline and no catalog point.
 */

export const NO_STORES_LABEL = "Noch keine Filialadressen";
export const LEGEND_LABEL = "Zielregion";

export const FIT_PADDING_PX = 48;
export const FIT_MAX_ZOOM = 14;

/** Calm default when neither addresses nor a Zielregion can frame the map. */
export const GERMANY_VIEW = { lon: 10.4, lat: 51.1, zoom: 5.2 } as const;

/** Bestand pins stay dark so they read on the light basemap and the region fill. */
export const PIN_COLOR = "#143f3c";
export const EMPFEHLUNG_COLOR = "#d85a2a";
export const REGION_FILL = "#3d6fbf";
export const REGION_LINE = "#1d3f73";
export const REGION_FILL_OPACITY = 0.32;

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface StorePin {
  kind: "bestand";
  id: string;
  lon: number;
  lat: number;
  street: string;
  place: string;
  ariaLabel: string;
}

export interface EmpfehlungPin {
  kind: "empfehlung";
  id: string;
  lon: number;
  lat: number;
  title: string;
  ariaLabel: string;
}

export type MapCamera = { kind: "germany" } | { kind: "bounds"; bounds: Bounds };

export interface KarteModel {
  pins: StorePin[];
  empfehlungen: EmpfehlungPin[];
  region: FeatureCollection;
  showLegend: boolean;
  showEmptyAddresses: boolean;
  coordinateGapLabel: string | null;
  camera: MapCamera;
  cameraKey: string;
  markerKey: string;
  regionKey: string;
}

const EMPTY_REGION: FeatureCollection = { type: "FeatureCollection", features: [] };

export function buildKarte(input: {
  stores: StoreLocation[];
  region: TargetRegion | null;
  recommendations: Recommendation[];
  addressesKnownEmpty: boolean;
}): KarteModel {
  const pins = storePins(input.stores);
  const empfehlungen = empfehlungPins(input.recommendations);
  const overlay = regionOverlay(input.region);
  const camera = cameraFor(pins, overlay.bounds);
  const signature = dataSignature(input.stores, input.region, overlay);
  return {
    pins,
    empfehlungen,
    region: overlay.collection,
    showLegend: overlay.collection.features.length > 0,
    showEmptyAddresses: input.addressesKnownEmpty && input.stores.length === 0,
    coordinateGapLabel: input.stores.length > 0 ? coordinateGapLabel(input.stores) : null,
    camera,
    cameraKey: cameraKey(camera, signature),
    markerKey: JSON.stringify({ pins, empfehlungen }),
    regionKey: JSON.stringify(overlay.collection),
  };
}

export function storePins(stores: StoreLocation[]): StorePin[] {
  const pins: StorePin[] = [];
  for (const store of stores) {
    const point = coordinatesOf(store);
    if (!point) continue;
    const place = `${store.postalCode} ${store.city}`.trim();
    pins.push({
      kind: "bestand",
      id: store.id,
      lon: point.lon,
      lat: point.lat,
      street: store.street,
      place,
      ariaLabel: `${store.street}, ${place}`,
    });
  }
  return pins;
}

export function empfehlungPins(items: Recommendation[]): EmpfehlungPin[] {
  const pins: EmpfehlungPin[] = [];
  for (const item of items) {
    const point = coordinatesOf(item.location);
    if (!point) continue;
    const title = item.title.trim() || "Empfehlung";
    pins.push({
      kind: "empfehlung",
      id: item.id,
      lon: point.lon,
      lat: point.lat,
      title,
      ariaLabel: `${title}, Empfehlung`,
    });
  }
  return pins;
}

export function coordinateGapLabel(stores: StoreLocation[]): string | null {
  const missing = stores.filter((store) => coordinatesOf(store) === null).length;
  if (missing === 0) return null;
  if (missing === 1) return "Für 1 Filialadresse liegen keine Koordinaten vor.";
  return `Für ${missing} Filialadressen liegen keine Koordinaten vor.`;
}

export function regionOverlay(region: TargetRegion | null): {
  collection: FeatureCollection;
  bounds: Bounds | null;
} {
  if (!region) return { collection: EMPTY_REGION, bounds: null };
  const contractBounds = readContractBounds(region.bounds);
  const geometry = readRegionGeometry(region.geometry);
  const areas = geometry ? areaFeatures(geometry) : [];
  let bounds = contractBounds;
  for (const position of geometry ? positionsOf(geometry) : []) {
    bounds = extendBounds(bounds, position.lon, position.lat);
  }
  const point = coordinatesOf(region);
  if (point) bounds = extendBounds(bounds, point.lon, point.lat);

  // Draw the API polygon as returned. A bounds rectangle is only the fallback
  // when `geometry` is null.
  const features = areas.length > 0 ? areas : rectangleFeature(contractBounds);
  return {
    collection: { type: "FeatureCollection", features },
    bounds,
  };
}

/** `LonLatBounds` from OpenAPI 0.5.0. A bbox array is not the contract. */
export function readContractBounds(value: unknown): Bounds | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  return boundsFromNumbers(raw.west, raw.south, raw.east, raw.north);
}

/** `RegionGeometry`: Polygon or MultiPolygon. Other GeoJSON types are ignored. */
export function readRegionGeometry(value: unknown): RegionGeometry | null {
  const record = asRecord(value);
  if (!record || (record.type !== "Polygon" && record.type !== "MultiPolygon")) return null;
  if (!geometryPositions(record).ok) return null;
  return record.type === "Polygon"
    ? { type: "Polygon", coordinates: record.coordinates }
    : { type: "MultiPolygon", coordinates: record.coordinates };
}

function boundsFromNumbers(west: unknown, south: unknown, east: unknown, north: unknown): Bounds | null {
  if (!inLon(west) || !inLat(south) || !inLon(east) || !inLat(north)) return null;
  if (south > north || west > east) return null;
  return { west, south, east, north };
}

function cameraFor(pins: StorePin[], regionBounds: Bounds | null): MapCamera {
  let bounds = regionBounds;
  for (const pin of pins) {
    bounds = extendBounds(bounds, pin.lon, pin.lat);
  }
  if (!bounds) return { kind: "germany" };
  return { kind: "bounds", bounds };
}

function cameraKey(camera: MapCamera, signature: string): string {
  if (camera.kind === "germany") return `deutschland:${signature}`;
  const { west, south, east, north } = camera.bounds;
  return `rahmen:${west}:${south}:${east}:${north}:${signature}`;
}

function dataSignature(
  stores: StoreLocation[],
  region: TargetRegion | null,
  overlay: { collection: FeatureCollection; bounds: Bounds | null },
): string {
  const storesPart = stores
    .map((store) =>
      [store.id, store.lon ?? "", store.lat ?? "", store.street, store.postalCode, store.city, store.updatedAt].join(
        "~",
      ),
    )
    .join("|");
  const regionPart = region
    ? [region.label, region.updatedAt, region.lon ?? "", region.lat ?? "", overlay.collection.features.length].join("~")
    : "";
  return `${storesPart}#${regionPart}`;
}

function rectangleFeature(bounds: Bounds | null): Feature[] {
  if (!bounds || !hasArea(bounds)) return [];
  const polygon: Polygon = {
    type: "Polygon",
    coordinates: [
      [
        [bounds.west, bounds.south],
        [bounds.east, bounds.south],
        [bounds.east, bounds.north],
        [bounds.west, bounds.north],
        [bounds.west, bounds.south],
      ],
    ],
  };
  return [{ type: "Feature", properties: { name: LEGEND_LABEL }, geometry: polygon }];
}

function hasArea(bounds: Bounds): boolean {
  return bounds.east > bounds.west && bounds.north > bounds.south;
}

function extendBounds(bounds: Bounds | null, lon: number, lat: number): Bounds {
  if (!bounds) return { west: lon, south: lat, east: lon, north: lat };
  return {
    west: Math.min(bounds.west, lon),
    south: Math.min(bounds.south, lat),
    east: Math.max(bounds.east, lon),
    north: Math.max(bounds.north, lat),
  };
}

function areaFeatures(geometry: RegionGeometry): Feature[] {
  const record = asRecord(geometry);
  if (!record || !geometryPositions(record).ok) return [];
  const shape =
    record.type === "Polygon"
      ? { type: "Polygon" as const, coordinates: record.coordinates as Polygon["coordinates"] }
      : { type: "MultiPolygon" as const, coordinates: record.coordinates as Polygon["coordinates"][] };
  return [{ type: "Feature", properties: { name: LEGEND_LABEL }, geometry: shape }];
}

function positionsOf(geometry: RegionGeometry): { lon: number; lat: number }[] {
  const record = asRecord(geometry);
  if (!record) return [];
  return geometryPositions(record).positions;
}

function geometryPositions(record: Record<string, unknown>): {
  ok: boolean;
  positions: { lon: number; lat: number }[];
} {
  const type = record.type;
  if (
    type !== "Point" &&
    type !== "Polygon" &&
    type !== "MultiPolygon" &&
    type !== "LineString" &&
    type !== "MultiLineString"
  ) {
    return { ok: false, positions: [] };
  }
  const positions: { lon: number; lat: number }[] = [];
  const ok = walkCoordinates(record.coordinates, (lon, lat) => positions.push({ lon, lat }));
  if (!ok || positions.length === 0) return { ok: false, positions: [] };
  return { ok: true, positions };
}

function walkCoordinates(coordinates: unknown, visit: (lon: number, lat: number) => void): boolean {
  if (!Array.isArray(coordinates)) return false;
  if (typeof coordinates[0] === "number") {
    const lat = coordinates[1];
    if (!inLon(coordinates[0]) || !inLat(lat)) return false;
    visit(coordinates[0], lat);
    return true;
  }
  if (coordinates.length === 0) return false;
  return coordinates.every((child) => walkCoordinates(child, visit));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function inLon(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

function inLat(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

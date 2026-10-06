import type { Recommendation, RegionGeometry, StoreLocation, TargetRegion } from "@ruehrai/api-contracts";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import { coordinatesOf } from "../api/geo.ts";
import { regionListKey } from "../locations/regions.ts";
import { hitBadge, hitMapHint, hitName, overlapLageSentence } from "../recommendations/hit-copy.ts";

/**
 * Map model for the Karte page (KAN-48, KAN-50, KAN-51) on OpenAPI 0.5.0.
 *
 * Pins use `StoreLocation.lon` / `lat` from `GET /stores` (WGS84). The Backend
 * fills a missing pair from the PLZ centroid. A missing pair stays unpinned.
 * That is a coordinate hint, not the empty state. The empty copy is only for
 * zero saved addresses.
 *
 * `GET /target-region` returns `{ items }`. Each item may carry:
 * - `geometry`: GeoJSON Polygon or MultiPolygon for the colored overlay
 * - `bounds`: extent of that geometry. Bounds never become a rectangle.
 *
 * The camera frames drawn outlines and store pins. A row without a
 * Polygon or MultiPolygon does not contribute bounds.
 */

export const NO_STORES_LABEL = "Noch keine Filialadressen";
export const LEGEND_LABEL = "Zielregion";

/**
 * Hint when a Zielregion is saved and there is no Polygon or MultiPolygon to
 * draw. Bounds and a lon/lat pair still frame the camera; they are not a fill.
 */
export const MISSING_AREA_LABEL = "Zielregion ist gesetzt. Die Fläche kann noch nicht gezeichnet werden.";

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

/** Verlauf proof and Karte share these shapes. Bestand is never a teardrop. */
export const BESTAND_MARKER_SHAPE = "square" as const;
export const EMPFEHLUNG_MARKER_SHAPE = "numbered-disk" as const;

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
  rank: number;
  lon: number;
  lat: number;
  title: string;
  ariaLabel: string;
}

export type MapCamera = { kind: "germany" } | { kind: "bounds"; bounds: Bounds };

export interface HitOutline {
  id: string;
  rank: number;
  title: string;
  badge: string;
  /** Same Lage-Satz as the card header; omitted when overlaps are missing. */
  lage: string | null;
  /** Rang, Name, Badge, Lage-Satz for hover/tap. */
  hint: string;
  ariaLabel: string;
  lon: number;
  lat: number;
}

export interface KarteModel {
  pins: StorePin[];
  empfehlungen: EmpfehlungPin[];
  hits: FeatureCollection;
  hitMarkers: HitOutline[];
  region: FeatureCollection;
  showLegend: boolean;
  showEmptyAddresses: boolean;
  coordinateGapLabel: string | null;
  /** Kept for the Karte notices slot; missing-area copy now lives on the list row. */
  missingAreaLabel: string | null;
  regionFrameOnly: boolean;
  camera: MapCamera;
  cameraKey: string;
  markerKey: string;
  regionKey: string;
  hitKey: string;
}

const EMPTY_REGION: FeatureCollection = { type: "FeatureCollection", features: [] };

export function buildKarte(input: {
  stores: StoreLocation[];
  regions: TargetRegion[];
  markedKey?: string | null;
  recommendations: Recommendation[];
  addressesKnownEmpty: boolean;
}): KarteModel {
  const pins = storePins(input.stores);
  const empfehlungen = empfehlungPins(input.recommendations);
  const overlay = regionsOverlay(input.regions ?? [], input.markedKey ?? null);
  const drawable = overlay.collection.features.length > 0;
  const camera = cameraFor(pins, overlay.bounds);
  const signature = dataSignature(input.stores, input.regions, overlay);
  return {
    pins,
    empfehlungen,
    hits: EMPTY_REGION,
    hitMarkers: [],
    region: overlay.collection,
    showLegend: drawable,
    showEmptyAddresses: input.addressesKnownEmpty && input.stores.length === 0,
    coordinateGapLabel: input.stores.length > 0 ? coordinateGapLabel(input.stores) : null,
    missingAreaLabel: null,
    regionFrameOnly: false,
    camera,
    cameraKey: cameraKey(camera, signature),
    markerKey: JSON.stringify({ pins, empfehlungen }),
    regionKey: JSON.stringify(overlay.collection),
    hitKey: "[]",
  };
}

/**
 * Trefferliste map: only `items[].geometry` plus a thin Zielregion frame.
 * Lon/lat and bounds never become a stand-in outline or point.
 * No extra Bezirk borders and no percent labels on the map itself;
 * the Lage-Satz lives on the hover/tap hint only.
 */
export function buildTrefferlisteKarte(input: {
  region: TargetRegion | null;
  items: Recommendation[];
}): KarteModel {
  const overlay = regionsOverlay(input.region ? [input.region] : [], input.region ? regionListKey(input.region) : null);
  const drawn = hitOutlines(input.items);
  const camera = cameraForHits(drawn.bounds, overlay.bounds);
  const signature = `${JSON.stringify(overlay.collection)}#${JSON.stringify(drawn.collection)}`;
  return {
    pins: [],
    empfehlungen: [],
    hits: drawn.collection,
    hitMarkers: drawn.markers,
    region: overlay.collection,
    showLegend: overlay.collection.features.length > 0,
    showEmptyAddresses: false,
    coordinateGapLabel: null,
    missingAreaLabel: null,
    regionFrameOnly: true,
    camera,
    cameraKey: cameraKey(camera, signature),
    markerKey: JSON.stringify(drawn.markers),
    regionKey: JSON.stringify(overlay.collection),
    hitKey: JSON.stringify(drawn.collection),
  };
}

export function hitOutlines(items: readonly Recommendation[]): {
  collection: FeatureCollection;
  markers: HitOutline[];
  bounds: Bounds | null;
} {
  const features: Feature[] = [];
  const markers: HitOutline[] = [];
  let bounds: Bounds | null = null;
  for (const item of items) {
    const geometry = readRegionGeometry(item.geometry);
    if (!geometry) continue;
    const name = hitName(item);
    const title = name || "Treffer";
    const badge = hitBadge(item);
    const hint = hitMapHint(item);
    features.push({
      type: "Feature",
      id: item.id,
      properties: { id: item.id, rank: item.rank, name: title, marked: false },
      geometry:
        geometry.type === "Polygon"
          ? { type: "Polygon" as const, coordinates: geometry.coordinates as Polygon["coordinates"] }
          : { type: "MultiPolygon" as const, coordinates: geometry.coordinates as Polygon["coordinates"][] },
    });
    for (const position of positionsOf(geometry)) {
      bounds = extendBounds(bounds, position.lon, position.lat);
    }
    const label = geometryLabelPoint(geometry);
    if (label) {
      markers.push({
        id: item.id,
        rank: item.rank,
        title,
        badge,
        lage: overlapLageSentence(item.overlaps),
        hint,
        ariaLabel: hint,
        lon: label.lon,
        lat: label.lat,
      });
    }
  }
  return {
    collection: { type: "FeatureCollection", features },
    markers,
    bounds,
  };
}

/** Label position from the official outline. Never a lon/lat substitute. */
export function geometryLabelPoint(geometry: RegionGeometry): { lon: number; lat: number } | null {
  const positions = positionsOf(geometry);
  if (positions.length === 0) return null;
  const lon = positions.reduce((sum, point) => sum + point.lon, 0) / positions.length;
  const lat = positions.reduce((sum, point) => sum + point.lat, 0) / positions.length;
  if (!inLon(lon) || !inLat(lat)) return null;
  return { lon, lat };
}

export function regionHasDrawableArea(region: TargetRegion): boolean {
  return readRegionGeometry(region.geometry) !== null;
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
    const title = hitName(item) || "Empfehlung";
    pins.push({
      kind: "empfehlung",
      id: item.id,
      rank: item.rank,
      lon: point.lon,
      lat: point.lat,
      title,
      ariaLabel: `${title}, Empfehlung ${item.rank}`,
    });
  }
  return pins;
}

/** Addresses exist, but at least one has no usable WGS84 pair. */
export function coordinateGapLabel(stores: StoreLocation[]): string | null {
  const missing = stores.filter((store) => coordinatesOf(store) === null).length;
  if (missing === 0) return null;
  const label = missing === 1 ? "1 Filialadresse ohne Koordinaten" : `${missing} Filialadressen ohne Koordinaten`;
  const pinned = stores.length - missing;
  if (pinned > 0) return `${label}.`;
  const verb = missing === 1 ? "erscheint sie" : "erscheinen sie";
  return `${label}. Deshalb ${verb} nicht auf der Karte.`;
}

export function regionOverlay(region: TargetRegion | null): {
  collection: FeatureCollection;
  bounds: Bounds | null;
} {
  return regionsOverlay(region ? [region] : [], region ? regionListKey(region) : null);
}

export function regionsOverlay(
  regions: readonly TargetRegion[],
  markedKey: string | null,
): {
  collection: FeatureCollection;
  bounds: Bounds | null;
} {
  if (regions.length === 0) return { collection: EMPTY_REGION, bounds: null };
  const features: Feature[] = [];
  let bounds: Bounds | null = null;
  for (const region of regions) {
    const geometry = readRegionGeometry(region.geometry);
    if (!geometry) continue;
    const key = regionListKey(region);
    features.push(...areaFeatures(geometry, key, key === markedKey));
    for (const position of positionsOf(geometry)) {
      bounds = extendBounds(bounds, position.lon, position.lat);
    }
  }
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

function cameraForHits(hitBounds: Bounds | null, regionBounds: Bounds | null): MapCamera {
  let bounds = regionBounds;
  if (hitBounds) {
    bounds = bounds
      ? {
          west: Math.min(bounds.west, hitBounds.west),
          south: Math.min(bounds.south, hitBounds.south),
          east: Math.max(bounds.east, hitBounds.east),
          north: Math.max(bounds.north, hitBounds.north),
        }
      : hitBounds;
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
  regions: readonly TargetRegion[],
  overlay: { collection: FeatureCollection; bounds: Bounds | null },
): string {
  const storesPart = stores
    .map((store) =>
      [store.id, store.lon ?? "", store.lat ?? "", store.street, store.postalCode, store.city, store.updatedAt].join(
        "~",
      ),
    )
    .join("|");
  const regionPart = regions
    .map((region) =>
      [regionListKey(region), region.label, region.updatedAt, overlay.collection.features.length].join("~"),
    )
    .join("|");
  return `${storesPart}#${regionPart}`;
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

function areaFeatures(geometry: RegionGeometry, geoKey: string, marked: boolean): Feature[] {
  const record = asRecord(geometry);
  if (!record || !geometryPositions(record).ok) return [];
  const shape =
    record.type === "Polygon"
      ? { type: "Polygon" as const, coordinates: record.coordinates as Polygon["coordinates"] }
      : { type: "MultiPolygon" as const, coordinates: record.coordinates as Polygon["coordinates"][] };
  return [
    {
      type: "Feature",
      id: geoKey,
      properties: { name: LEGEND_LABEL, geoKey, marked },
      geometry: shape,
    },
  ];
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

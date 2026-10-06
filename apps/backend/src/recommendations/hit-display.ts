import { AnalysisRegion } from "../analysis/types";
import { emptyToNull } from "../customer/values";
import { gemeindeDisplayNameFromAgs, municipalityAgsFromDisplayName } from "../geo/geo-catalog";
import { municipalityAgsFrom } from "../analysis/yearly-series";
import { AreaCandidate, AreaKind, isAreaKind, isKoelnQuartierKey, isLorPlrKey } from "./area-candidates";

/** Catalog ids such as `plz5:12247` or `ortsteil:osm:5712247`. Never visible copy. */
const CATALOG_KEY =
  /^(?:ags|ags5|plz5|plz8|bezirk|stadtbezirk|stadtteil|ortsteil|lor:plr|lor|koeln:sq|quartier|hamburg_stadtteil|address|grid100)(?::\S+)+$/i;

const BARE_PLZ = /^\d{4,5}$/;

export function isHiddenCatalogKey(value: string | null | undefined): boolean {
  if (!value) return false;
  return CATALOG_KEY.test(value.trim());
}

/** Display name only. Empty and catalog keys become null (liegt nicht vor). */
export function visibleAreaName(value: string | null | undefined): string | null {
  const trimmed = emptyToNull(value);
  if (!trimmed || isHiddenCatalogKey(trimmed)) return null;
  return trimmed;
}

export type AreaNameSource = Pick<AreaCandidate, "kind" | "grain" | "geoKey" | "name" | "title" | "plz">;

/**
 * Always-filled UI name. Prefers a real catalog / feature name, never a raw
 * catalog key or internal id (`osm:…`, `id:…`, `address:…`, geo_addr,
 * INSPIRE / cell ids, "unbekannt"). Fallbacks: `PLZ 80331`,
 * `Planungsraum ohne Namen`, `Quartier ohne Namen`, `100-m-Rasterzelle`,
 * Straße + Hausnummer or `Adresse ohne Hausnummer`, otherwise
 * `{Art} ohne Namen`.
 */
export function displayAreaName(candidate: AreaNameSource): string {
  if (candidate.kind === "grid100" || candidate.grain === "grid100") {
    return "100-m-Rasterzelle";
  }
  const preferred = preferredVisibleName(candidate);
  if (preferred) {
    if (candidate.kind === "plz" && BARE_PLZ.test(preferred)) return `PLZ ${preferred}`;
    if (isPlausibleDisplayName(preferred)) return preferred;
  }
  return fallbackAreaName(candidate);
}

/** True when a display string still contains a catalog key, geo id, or "unbekannt". */
export function nameContainsForbiddenToken(value: string): boolean {
  return looksLikeInternalId(value);
}

/**
 * Parent area is the **Gemeinde** for every hit below municipality
 * (stadtbezirk, bezirk, stadtteil, ortsteil, quartier, lor, plz, raster,
 * adresse). Gemeinde hits stay null. Never the first coarser candidate in
 * the AGS5 pool (that produced Allach-Untermenzing / PLZ 50667).
 */
export function hitParentLabel(
  hit: AreaCandidate,
  pool: AreaCandidate[],
  regions: AnalysisRegion[],
  byGroup?: Map<string, AreaCandidate[]>,
): string | null {
  if (hit.kind === "gemeinde") return null;
  const fromHit = visibleAreaName(hit.municipalityName);
  if (fromHit) return fromHit;
  const fromPool = municipalityNameFromPool(hit, pool, byGroup);
  if (fromPool) return fromPool;
  const fromRegion = municipalityNameFromRegions(hit, regions);
  if (fromRegion) return fromRegion;
  return (
    gemeindeDisplayNameFromAgs(hit.ags) ??
    gemeindeDisplayNameFromAgs(hit.geoKey) ??
    null
  );
}

export function areaGroupKey(item: { geoKey?: string | null; ags?: string | null; plz?: string | null }): string {
  const ags = item.ags?.trim() ?? "";
  if (ags.length >= 5) return `ags:${ags.slice(0, 5)}`;
  const plz = item.plz?.trim() ?? "";
  if (plz) return `plz:${plz}`;
  return `key:${item.geoKey?.trim() ?? ""}`;
}

function preferredVisibleName(candidate: AreaNameSource): string | null {
  const fromName = visibleAreaName(candidate.name);
  if (fromName && !looksLikeInternalId(fromName)) return fromName;
  if (candidate.kind === "quartier") {
    const fromTitle = parseQuartierTitle(candidate.title);
    if (fromTitle && !looksLikeInternalId(fromTitle)) return fromTitle;
  }
  const fromTitle = visibleAreaName(candidate.title);
  if (fromTitle && !looksLikeInternalId(fromTitle)) return fromTitle;
  return null;
}

function fallbackAreaName(candidate: AreaNameSource): string {
  if (candidate.kind === "plz" || candidate.grain === "plz5" || candidate.grain === "plz8") {
    const digits = plzDigits(candidate);
    return digits ? `PLZ ${digits}` : unnamedKind("plz");
  }
  if (candidate.kind === "lor" || isLorPlrKey(candidate.geoKey)) {
    return unnamedKind("lor");
  }
  if (candidate.kind === "quartier" || isKoelnQuartierKey(candidate.geoKey)) {
    return unnamedKind("quartier");
  }
  if (candidate.kind === "grid100" || candidate.grain === "grid100") {
    return unnamedKind("grid100");
  }
  if (candidate.kind === "address" || candidate.grain === "address") {
    return addressFallback(candidate);
  }
  return unnamedKind(candidate.kind);
}

function parseQuartierTitle(title: string | null | undefined): string | null {
  const visible = visibleAreaName(title);
  if (!visible) return null;
  const tagged = /Quartier\s+(.+?)(?:\s*\([^)]*\)\s*)?$/i.exec(visible);
  const fromTagged = emptyToNull(tagged?.[1]);
  if (fromTagged && isPlausibleDisplayName(fromTagged)) return fromTagged;
  const stripped = visible.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const cleaned = visibleAreaName(stripped);
  if (cleaned && isPlausibleDisplayName(cleaned) && !/^quartier$/i.test(cleaned)) return cleaned;
  return null;
}

function plzDigits(candidate: AreaNameSource): string | null {
  const fromPlz = candidate.plz?.replace(/\D/g, "") ?? "";
  if (BARE_PLZ.test(fromPlz)) return fromPlz;
  const fromKey = bareCatalogTail(candidate.geoKey).replace(/\D/g, "");
  if (BARE_PLZ.test(fromKey)) return fromKey;
  const fromName = (candidate.name ?? candidate.title ?? "").replace(/\D/g, "");
  if (BARE_PLZ.test(fromName)) return fromName;
  return null;
}

function addressFallback(candidate: AreaNameSource): string {
  const fromVisible = visibleAreaName(candidate.name) ?? visibleAreaName(candidate.title);
  if (fromVisible && isPlausibleDisplayName(fromVisible)) return fromVisible;
  return unnamedKind("address");
}

function unnamedKind(kind: AreaKind): string {
  if (kind === "ortsteil") return "Ortsteil ohne Namen";
  if (kind === "stadtteil") return "Stadtteil ohne Namen";
  if (kind === "bezirk") return "Bezirk ohne Namen";
  if (kind === "stadtbezirk") return "Stadtbezirk ohne Namen";
  if (kind === "gemeinde") return "Gemeinde ohne Namen";
  if (kind === "quartier") return "Quartier ohne Namen";
  if (kind === "plz") return "PLZ ohne Namen";
  if (kind === "lor") return "Planungsraum ohne Namen";
  if (kind === "address") return "Adresse ohne Hausnummer";
  return "100-m-Rasterzelle";
}

function looksLikeInternalId(value: string): boolean {
  const text = value.trim();
  if (!text) return true;
  if (isHiddenCatalogKey(text)) return true;
  if (/osm:|\bid:|address:|geo_addr|unbekannt|inspire/i.test(text)) return true;
  if (/^(?:cell[-_]?|grid)\S*$/i.test(text)) return true;
  if (/\b\d+m[NS]\d+[EW]\d+/i.test(text)) return true;
  if (/^\d+$/.test(text)) return true;
  if (/\d{6,}/.test(text)) return true;
  if (/\b\d{8}\b/.test(text)) return true;
  if (/\b(?:planungsraum|quartier|ortsteil|stadtteil|bezirk|stadtbezirk|gemeinde)\s+\S*\d/i.test(text)) {
    return true;
  }
  return false;
}

function isPlausibleDisplayName(value: string | null | undefined): boolean {
  const text = value?.trim() ?? "";
  if (!text || looksLikeInternalId(text)) return false;
  if (/:/.test(text)) return false;
  if (/^\d+$/.test(text)) return false;
  return /[a-zäöüß]/i.test(text);
}

function bareCatalogTail(geoKey: string | null | undefined): string {
  const value = geoKey?.trim() ?? "";
  const match =
    /^(?:ags|ags5|plz5|plz8|bezirk|stadtbezirk|stadtteil|ortsteil|grid100|address|lor:plr|koeln:sq|quartier|lor|hamburg_stadtteil):(.+)$/i.exec(
      value,
    );
  return match?.[1] ?? value;
}

function municipalityNameFromPool(
  hit: AreaCandidate,
  pool: AreaCandidate[],
  byGroup?: Map<string, AreaCandidate[]>,
): string | null {
  const group = byGroup?.get(areaGroupKey(hit)) ?? pool.filter((candidate) => areaGroupKey(candidate) === areaGroupKey(hit));
  for (const candidate of group) {
    if (candidate.kind !== "gemeinde") continue;
    const name = visibleAreaName(candidate.municipalityName) ?? visibleAreaName(candidate.name) ?? visibleAreaName(candidate.title);
    if (name) return name;
  }
  return null;
}

function municipalityNameFromRegions(hit: AreaCandidate, regions: AnalysisRegion[]): string | null {
  const region = matchingParentRegion(hit, regions);
  if (!region) return null;
  return municipalityNameOfRegion(region);
}

function municipalityNameOfRegion(region: AnalysisRegion): string | null {
  if (kindOfRegion(region) === "gemeinde") {
    const label = visibleAreaName(region.label);
    if (label) return label;
  }
  const parent = visibleAreaName(region.parentLabel);
  if (parent) return parent;
  const fromAgs =
    gemeindeDisplayNameFromAgs(region.ags) ??
    gemeindeDisplayNameFromAgs(region.geoKey) ??
    gemeindeDisplayNameFromAgs(municipalityAgsFromDisplayName(region.parentLabel)) ??
    gemeindeDisplayNameFromAgs(municipalityAgsFromDisplayName(region.label));
  if (fromAgs) return fromAgs;
  if (kindOfRegion(region) === "gemeinde") return visibleAreaName(region.label);
  return null;
}

function matchingParentRegion(hit: AreaCandidate, regions: AnalysisRegion[]): AnalysisRegion | undefined {
  const targetKey = hit.targetRegionGeoKey?.trim();
  if (targetKey) {
    const byTarget = regions.find((region) => (region.geoKey?.trim() ?? "") === targetKey);
    if (byTarget) return byTarget;
  }
  const hitAgs = (municipalityAgsFrom(hit) ?? hit.ags)?.trim() ?? "";
  const byAgs = hitAgs
    ? regions.find((region) => {
        const regionAgs = (municipalityAgsFrom(region) ?? region.ags)?.trim() ?? "";
        return Boolean(regionAgs && regionAgs === hitAgs);
      })
    : undefined;
  if (byAgs) return byAgs;
  const group = areaGroupKey(hit);
  const byGroup = regions.find((region) => areaGroupKey(region) === group);
  if (byGroup && group.startsWith("ags:")) return byGroup;
  return regions.find((region) => {
    const geoKey = region.geoKey?.trim();
    const regionAgs = region.ags?.trim() ?? "";
    const itemAgs = hit.ags?.trim() ?? "";
    return Boolean(
      geoKey &&
        (geoKey === hit.geoKey || geoKey === hit.ags || (regionAgs.length > 0 && regionAgs === itemAgs)),
    );
  });
}

function kindOfRegion(region: AnalysisRegion): AreaKind | null {
  if (isAreaKind(region.level)) return region.level;
  if (region.grain === "plz5" || region.grain === "plz8") return "plz";
  if (region.grain === "ags") return "gemeinde";
  return null;
}

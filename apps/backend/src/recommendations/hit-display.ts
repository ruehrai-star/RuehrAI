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
 * catalog key. Fallbacks: `PLZ 80331`, `Planungsraum <code>`, `Quartier <id>`,
 * `Rasterzelle <id>`, Straße + Hausnummer, otherwise a short readable form.
 */
export function displayAreaName(candidate: AreaNameSource): string {
  const preferred = preferredVisibleName(candidate);
  if (preferred) {
    if (candidate.kind === "plz" && BARE_PLZ.test(preferred)) return `PLZ ${preferred}`;
    const tail = bareCatalogTail(candidate.geoKey);
    if (preferred !== candidate.geoKey.trim() && preferred !== tail) return preferred;
  }
  return fallbackAreaName(candidate);
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
  if (fromName) return fromName;
  if (candidate.kind === "quartier") {
    const fromTitle = parseQuartierTitle(candidate.title);
    if (fromTitle) return fromTitle;
  }
  return visibleAreaName(candidate.title);
}

function fallbackAreaName(candidate: AreaNameSource): string {
  if (candidate.kind === "plz" || candidate.grain === "plz5" || candidate.grain === "plz8") {
    return `PLZ ${plzDigits(candidate)}`;
  }
  if (candidate.kind === "lor" || isLorPlrKey(candidate.geoKey)) {
    return `Planungsraum ${lorCode(candidate.geoKey)}`;
  }
  if (candidate.kind === "quartier" || isKoelnQuartierKey(candidate.geoKey)) {
    return `Quartier ${quartierId(candidate.geoKey)}`;
  }
  if (candidate.kind === "grid100" || candidate.grain === "grid100") {
    return `Rasterzelle ${bareCatalogTail(candidate.geoKey)}`;
  }
  if (candidate.kind === "address" || candidate.grain === "address") {
    return addressFallback(candidate);
  }
  return humanizedKey(candidate.geoKey, candidate.kind);
}

function parseQuartierTitle(title: string | null | undefined): string | null {
  const visible = visibleAreaName(title);
  if (!visible) return null;
  const tagged = /Quartier\s+(.+?)(?:\s*\([^)]*\)\s*)?$/i.exec(visible);
  const fromTagged = emptyToNull(tagged?.[1]);
  if (fromTagged && !isHiddenCatalogKey(fromTagged) && !BARE_PLZ.test(fromTagged)) return fromTagged;
  const stripped = visible.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return visibleAreaName(stripped);
}

function plzDigits(candidate: AreaNameSource): string {
  const fromPlz = candidate.plz?.replace(/\D/g, "") ?? "";
  if (BARE_PLZ.test(fromPlz)) return fromPlz;
  const fromKey = bareCatalogTail(candidate.geoKey).replace(/\D/g, "");
  if (BARE_PLZ.test(fromKey)) return fromKey;
  const fromName = (candidate.name ?? candidate.title ?? "").replace(/\D/g, "");
  if (BARE_PLZ.test(fromName)) return fromName;
  return bareCatalogTail(candidate.geoKey) || "unbekannt";
}

function lorCode(geoKey: string): string {
  const tail = bareCatalogTail(geoKey);
  return tail.replace(/^plr:/i, "") || geoKey;
}

function quartierId(geoKey: string): string {
  return bareCatalogTail(geoKey) || geoKey;
}

function addressFallback(candidate: AreaNameSource): string {
  const fromVisible = visibleAreaName(candidate.name) ?? visibleAreaName(candidate.title);
  if (fromVisible && !isHiddenCatalogKey(fromVisible)) return fromVisible;
  const tail = bareCatalogTail(candidate.geoKey).replace(/[_+]+/g, " ").trim();
  return tail || `Adresse ${candidate.geoKey}`;
}

function humanizedKey(geoKey: string, kind: AreaKind): string {
  const tail = bareCatalogTail(geoKey);
  if (tail && !isHiddenCatalogKey(tail) && !/^(osm|id):\S+/i.test(tail)) {
    return kindLabel(kind, tail);
  }
  return kindLabel(kind, tail || geoKey);
}

function kindLabel(kind: AreaKind, id: string): string {
  if (kind === "ortsteil") return `Ortsteil ${id}`;
  if (kind === "stadtteil") return `Stadtteil ${id}`;
  if (kind === "bezirk") return `Bezirk ${id}`;
  if (kind === "stadtbezirk") return `Stadtbezirk ${id}`;
  if (kind === "gemeinde") return `Gemeinde ${id}`;
  return id;
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
  const region = matchingParentRegion(hit, regions) ?? regions[0];
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
  const group = areaGroupKey(hit);
  return (
    regions.find((region) => areaGroupKey(region) === group) ??
    regions.find((region) => {
      const geoKey = region.geoKey?.trim();
      return Boolean(geoKey && (geoKey === hit.geoKey || geoKey === hit.ags || region.ags === hit.ags));
    }) ??
    regions.find((region) => {
      const hitAgs = municipalityAgsFrom(hit);
      const regionAgs = municipalityAgsFrom(region);
      return Boolean(hitAgs && regionAgs && hitAgs === regionAgs);
    })
  );
}

function kindOfRegion(region: AnalysisRegion): AreaKind | null {
  if (isAreaKind(region.level)) return region.level;
  if (region.grain === "plz5" || region.grain === "plz8") return "plz";
  if (region.grain === "ags") return "gemeinde";
  return null;
}

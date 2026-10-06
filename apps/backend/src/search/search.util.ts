import { gemeindeDisplayNameFromAgs, officialAgsKey, parentMunicipalityAgs } from "../geo/geo-catalog";
import { SearchQueryDto } from "./search.dto";

/** LIKE/ILIKE contains-pattern. `%`, `_`, and `\` in the input are matched literally. */
export function toContainsPattern(value: string): string {
  const escaped = value.replace(/[\\%_]/g, (char) => `\\${char}`);
  return `%${escaped}%`;
}

/**
 * PLZ hits are allowed when `q` is omitted, or when the whole free-text
 * value is digits. A name such as München / Hamburg / Leipzig must not
 * surface `level=plz` rows.
 */
export function allowPlzHits(q?: string): boolean {
  if (q == null || q.length === 0) return true;
  return /^\d+$/.test(q);
}

/** `plz5:12247`, `ortsteil:osm:…`, `ags:…` — never a free-text hit. */
export function isInternalCatalogKeyQuery(q?: string): boolean {
  if (!q) return false;
  return /^(plz5|plz8|ags|bezirk|stadtbezirk|stadtteil|ortsteil):/i.test(q);
}

export function hasVisibleLabel(label: string | null | undefined): boolean {
  return typeof label === "string" && label.trim().length > 0;
}

export function isPlzHit(hit: { level?: string | null; grain?: string | null }): boolean {
  return hit.level === "plz" || hit.grain === "plz5" || hit.grain === "plz8";
}

/** Shared `$1`–`$9` for catalog, feature-view, and seed search SQL. `$9` is token patterns (AND). */
export function searchFilterParams(query: SearchQueryDto): unknown[] {
  return [
    query.ags ?? null,
    query.plz ?? null,
    query.address ? toContainsPattern(query.address) : null,
    query.q ? toContainsPattern(query.q) : null,
    query.type ?? null,
    query.geoKey ?? null,
    query.grain ?? null,
    allowPlzHits(query.q),
    searchTokenPatterns(query.q),
  ];
}

/** Split free-text `q` into tokens matched in any order against name or Gemeinde. */
export function searchQueryTokens(q?: string): string[] {
  if (!q) return [];
  return q
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export function searchTokenPatterns(q?: string): string[] | null {
  const tokens = searchQueryTokens(q);
  if (tokens.length === 0) return null;
  return tokens.map(toContainsPattern);
}

const AREALESS_ADMIN_LEVELS = new Set(["bezirk", "stadtbezirk", "stadtteil", "ortsteil"]);

/**
 * Feature-view AGS Stadtbezirke of kreisfreie Städte (Köln `05315001`)
 * have no catalog polygon. A Gemeinde AGS such as Berlingen `07233004`
 * is not a district even though it does not end in `000`.
 */
export function isArealessAdminHit(hit: {
  grain: string;
  geoKey?: string | null;
  level?: string | null;
}): boolean {
  const level = hit.level?.trim().toLowerCase() ?? "";
  if (!AREALESS_ADMIN_LEVELS.has(level)) return false;
  const key = hit.geoKey?.trim() ?? "";
  if (/^(bezirk|stadtbezirk|stadtteil|ortsteil):/i.test(key)) return false;
  const official = officialAgsKey(key);
  if (!official || official.endsWith("000")) return false;
  return gemeindeDisplayNameFromAgs(official) != null;
}

export function normalizeAdminSearchName(label: string, parentLabel?: string | null): string {
  let text = label.trim().toLocaleLowerCase("de").replace(/[-–—]/g, " ");
  text = text.replace(/^(bezirk|stadtbezirk|stadtteil|ortsteil)\s+/i, "");
  const parent = (parentLabel ?? "").trim().toLocaleLowerCase("de");
  if (parent) {
    const escaped = parent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`^${escaped}\\s+`, "i"), "");
  }
  return text.replace(/\s+/g, " ").trim();
}

export function sameSearchMunicipality(
  left: { parentLabel?: string | null; geoKey?: string | null; geoAgs?: string | null },
  right: { parentLabel?: string | null; geoKey?: string | null; geoAgs?: string | null },
): boolean {
  const parentLeft = (left.parentLabel ?? "").trim().toLocaleLowerCase("de");
  const parentRight = (right.parentLabel ?? "").trim().toLocaleLowerCase("de");
  if (parentLeft && parentRight && parentLeft === parentRight) return true;
  const agsLeft = parentMunicipalityAgs(left.geoKey) ?? officialAgsKey(left.geoAgs) ?? parentMunicipalityAgs(left.geoAgs);
  const agsRight =
    officialAgsKey(right.geoAgs) ?? parentMunicipalityAgs(right.geoKey) ?? parentMunicipalityAgs(right.geoAgs);
  if (agsLeft && agsRight && agsLeft === agsRight) return true;
  return false;
}

export function matchCatalogAdminHit<T extends {
  label: string;
  level?: string | null;
  parentLabel?: string | null;
  geoKey?: string | null;
  geoAgs?: string | null;
}>(hit: T, catalog: T[]): T | null {
  const needle = normalizeAdminSearchName(hit.label, hit.parentLabel);
  if (!needle) return null;
  for (const candidate of catalog) {
    const level = candidate.level?.trim().toLowerCase() ?? "";
    const hitLevel = hit.level?.trim().toLowerCase() ?? "";
    if (hitLevel && level && level !== hitLevel) continue;
    if (!sameSearchMunicipality(hit, candidate)) continue;
    if (normalizeAdminSearchName(candidate.label, candidate.parentLabel) === needle) return candidate;
  }
  return null;
}

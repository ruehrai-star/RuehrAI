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

/** Shared `$1`–`$8` for catalog, feature-view, and seed search SQL. */
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
  ];
}

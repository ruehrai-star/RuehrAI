import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { isMissingFeaturesRelation } from "../database/pg-error";
import {
  CatalogLevel,
  applyAdminCatalogDisplay,
  catalogDedupKey,
  catalogLevelForPlace,
  catalogNameDedupKey,
  officialAgsKey,
  parentMunicipalityAgs,
} from "../geo/geo-catalog";
import { GeoCatalogService } from "../geo/geo-catalog.service";
import { SearchQueryDto } from "./search.dto";
import {
  allowPlzHits,
  hasVisibleLabel,
  isInternalCatalogKeyQuery,
  isPlzHit,
  searchFilterParams,
  searchQueryTokens,
} from "./search.util";

export interface SearchHit {
  id: string;
  label: string;
  grain: string;
  geoKey: string | null;
  level?: CatalogLevel | null;
  parentLabel?: string | null;
  geoAgs?: string | null;
  lon: number | null;
  lat: number | null;
}

interface HitRow {
  id: string;
  label: string;
  grain: string;
  geo_key: string | null;
  lon: number | string | null;
  lat: number | string | null;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private fallbackNoted = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly geoCatalog: GeoCatalogService,
  ) {}

  async search(query: SearchQueryDto): Promise<{ hits: SearchHit[] }> {
    if (isInternalCatalogKeyQuery(query.q)) {
      return { hits: [] };
    }
    const [catalog, fallback] = await Promise.all([
      this.geoCatalog.search(query),
      this.searchExisting(query),
    ]);
    const resolved = await this.resolveAgsDisplay(fallback, catalog);
    return { hits: mergeHits(catalog, resolved, query.q) };
  }

  /**
   * Official AGS Stadtbezirke (09162004) are grain `ags` in the feature view.
   * Admin tells a Gemeinde from a district; catalog parentLabel is copied when
   * present. Names are never invented.
   */
  private async resolveAgsDisplay(fallback: SearchHit[], catalog: SearchHit[]): Promise<SearchHit[]> {
    const parentByAgs = new Map<string, string>();
    for (const hit of catalog) {
      const parent = hit.parentLabel?.trim();
      const ags = hit.geoAgs?.trim();
      if (parent && ags && !parentByAgs.has(ags)) parentByAgs.set(ags, parent);
    }
    const adminKeys = new Set<string>();
    for (const hit of fallback) {
      const key = officialAgsKey(hit.geoKey);
      if (key) adminKeys.add(key);
      const parentKey = parentMunicipalityAgs(key);
      if (parentKey) adminKeys.add(parentKey);
    }
    const admin = await this.geoCatalog.lookupAdminNames([...adminKeys]);
    return fallback.map((hit) => {
      const applied = applyAdminCatalogDisplay(
        { ...hit, parentLabel: hit.parentLabel ?? parentByAgs.get(parentMunicipalityAgs(hit.geoKey) ?? "") ?? null },
        admin,
      );
      const parentLabel = applied.parentLabel ?? parentByAgs.get(parentMunicipalityAgs(hit.geoKey) ?? "") ?? null;
      return {
        ...hit,
        level: applied.level ?? hit.level ?? null,
        ...(parentLabel ? { parentLabel } : {}),
      };
    });
  }

  private async searchExisting(query: SearchQueryDto): Promise<SearchHit[]> {
    const fromView = await this.searchFeatureView(query);
    if (fromView) return fromView;
    return this.searchSeed(query);
  }

  private async searchFeatureView(query: SearchQueryDto): Promise<SearchHit[] | null> {
    try {
      const probe = await this.db.queryReadingFeatures<{ has_rows: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM features.v_location_search) AS has_rows",
      );
      if (!probe.rows[0]?.has_rows) {
        this.noteFallback("features.v_location_search is empty");
        return null;
      }
      const result = await this.db.queryReadingFeatures<HitRow>(
        FEATURE_SEARCH_SQL,
        searchFilterParams(query),
      );
      return result.rows.map(toHit).filter((hit): hit is SearchHit => hit !== null);
    } catch (error) {
      if (isMissingFeaturesRelation(error)) {
        this.noteFallback("features.v_location_search is not installed");
        return null;
      }
      throw error;
    }
  }

  private async searchSeed(query: SearchQueryDto): Promise<SearchHit[]> {
    const result = await this.db.query<HitRow>(SEED_SEARCH_SQL, searchFilterParams(query));
    return result.rows.map(toHit).filter((hit): hit is SearchHit => hit !== null);
  }

  private noteFallback(reason: string): void {
    if (this.fallbackNoted) return;
    this.fallbackNoted = true;
    this.logger.log(`GET /search is using app.search_places (${reason}).`);
  }
}

function toHit(row: HitRow): SearchHit | null {
  if (!hasVisibleLabel(row.label)) return null;
  const geoKey = row.geo_key ?? null;
  const level = catalogLevelForPlace({
    grain: row.grain,
    geoKey,
    ags: row.grain === "ags" ? geoKey : null,
  });
  return {
    id: row.id,
    label: row.label.trim(),
    grain: row.grain,
    geoKey,
    ...(level ? { level } : {}),
    lon: toCoord(row.lon),
    lat: toCoord(row.lat),
  };
}

function mergeHits(catalog: SearchHit[], existing: SearchHit[], q?: string): SearchHit[] {
  const keepPlz = allowPlzHits(q);
  const needle = q?.trim().toLowerCase() ?? "";
  const tokens = searchQueryTokens(q).map((token) => token.toLocaleLowerCase("de"));
  const candidates = [...catalog, ...existing]
    .filter((hit) => hasVisibleLabel(hit.label) && (keepPlz || !isPlzHit(hit)))
    .filter((hit) => matchesSearchTokens(hit, tokens))
    .sort((left, right) => compareSearchHits(left, right, needle));
  const seen = new Set<string>();
  const merged: SearchHit[] = [];
  for (const hit of candidates) {
    const keys = [catalogDedupKey(hit), catalogNameDedupKey(hit)];
    if (keys.some((key) => seen.has(key))) continue;
    for (const key of keys) seen.add(key);
    merged.push(hit);
  }
  return merged.slice(0, 50);
}

function matchesSearchTokens(hit: SearchHit, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const haystack = `${hit.label} ${hit.parentLabel ?? ""}`.toLocaleLowerCase("de");
  return tokens.every((token) => {
    const needle = token.replace(/[%_]/g, "").trim();
    if (!needle) return true;
    return haystack.includes(needle);
  });
}

function compareSearchHits(left: SearchHit, right: SearchHit, needle: string): number {
  const rankDelta = hitRank(left, needle) - hitRank(right, needle);
  if (rankDelta !== 0) return rankDelta;
  const labels = left.label.localeCompare(right.label, "de");
  if (labels !== 0) return labels;
  const parents = (left.parentLabel ?? "").localeCompare(right.parentLabel ?? "", "de");
  if (parents !== 0) return parents;
  return left.id.localeCompare(right.id);
}

function hitRank(hit: SearchHit, needle: string): number {
  if (!needle) return 1;
  if (hit.label.toLowerCase() === needle) return 0;
  if ((hit.geoKey ?? "").toLowerCase() === needle) return 0;
  if (hit.id.toLowerCase() === needle || hit.id.toLowerCase().endsWith(`:${needle}`)) return 0;
  return 1;
}

function toCoord(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

const TEXT_MATCH = `
  name ILIKE $4 ESCAPE '\\'
  OR title ILIKE $4 ESCAPE '\\'
`;

const TOKEN_AND_FEATURE = `
  CASE
    WHEN $9::text[] IS NOT NULL AND cardinality($9::text[]) > 0 THEN
      (
        SELECT bool_and(
          name ILIKE tok ESCAPE '\\'
          OR title ILIKE tok ESCAPE '\\'
        )
        FROM unnest($9::text[]) AS tok
      )
    ELSE (${TEXT_MATCH})
  END
`;

const HAS_FEATURE_NAME = `
  NULLIF(btrim(name), '') IS NOT NULL
  OR NULLIF(btrim(title), '') IS NOT NULL
`;

/** Equality on geo_key uses the Brain btree. `$6` is exact reload, not free-text. */
const FEATURE_SEARCH_SQL = `
  SELECT id::text AS id,
         COALESCE(
           NULLIF(btrim(name), ''),
           NULLIF(btrim(title), '')
         ) AS label,
         grain,
         geo_key,
         lon,
         lat
  FROM features.v_location_search
  WHERE (${HAS_FEATURE_NAME})
    AND ($1::text IS NULL OR (grain = 'ags' AND geo_key = $1))
    AND ($2::text IS NULL OR (grain IN ('plz5', 'plz8') AND geo_key = $2))
    AND (
      $3::text IS NULL
      OR name ILIKE $3 ESCAPE '\\'
      OR title ILIKE $3 ESCAPE '\\'
    )
    AND ($6::text IS NULL OR geo_key = $6)
    AND ($7::text IS NULL OR grain = $7)
    AND ($8::boolean OR grain NOT IN ('plz5', 'plz8'))
    AND (
      $4::text IS NULL AND $9::text[] IS NULL
      OR (
        $5::text = 'ags'
        AND grain = 'ags'
        AND (${TOKEN_AND_FEATURE})
      )
      OR (
        $5::text = 'plz'
        AND grain IN ('plz5', 'plz8')
        AND (${TOKEN_AND_FEATURE})
      )
      OR (
        $5::text = 'address'
        AND grain = 'address'
        AND (${TOKEN_AND_FEATURE})
      )
      OR (
        $5::text IS NULL
        AND (${TOKEN_AND_FEATURE})
      )
    )
  ORDER BY label ASC, id ASC
  LIMIT 50
`;

const SEED_TOKEN_MATCH = `
  CASE
    WHEN $9::text[] IS NOT NULL AND cardinality($9::text[]) > 0 THEN
      (
        SELECT bool_and(
          label ILIKE tok ESCAPE '\\'
          OR COALESCE(plz, '') ILIKE tok ESCAPE '\\'
          OR COALESCE(address, '') ILIKE tok ESCAPE '\\'
        )
        FROM unnest($9::text[]) AS tok
      )
    ELSE (
      label ILIKE $4 ESCAPE '\\'
      OR COALESCE(plz, '') ILIKE $4 ESCAPE '\\'
      OR COALESCE(address, '') ILIKE $4 ESCAPE '\\'
    )
  END
`;

const SEED_SEARCH_SQL = `
  SELECT id,
         label,
         grain,
         CASE
           WHEN grain IN ('plz5', 'plz8') THEN plz
           WHEN grain IN ('ags', 'ags5') THEN ags
           ELSE id
         END AS geo_key,
         lon,
         lat
  FROM app.search_places
  WHERE NULLIF(btrim(label), '') IS NOT NULL
    AND ($1::text IS NULL OR ags = $1)
    AND ($2::text IS NULL OR plz = $2)
    AND (
      $3::text IS NULL
      OR address ILIKE $3 ESCAPE '\\'
      OR label ILIKE $3 ESCAPE '\\'
    )
    AND ($6::text IS NULL OR id = $6 OR ags = $6 OR plz = $6)
    AND ($7::text IS NULL OR grain = $7)
    AND ($8::boolean OR grain NOT IN ('plz5', 'plz8'))
    AND (
      $4::text IS NULL AND $9::text[] IS NULL
      OR ($5::text = 'ags' AND grain IN ('ags', 'ags5') AND (${SEED_TOKEN_MATCH}))
      OR (
        $5::text = 'plz'
        AND grain IN ('plz5', 'plz8')
        AND (${SEED_TOKEN_MATCH})
      )
      OR (
        $5::text = 'address'
        AND (${SEED_TOKEN_MATCH})
      )
      OR (
        $5::text IS NULL
        AND (${SEED_TOKEN_MATCH})
      )
    )
  ORDER BY label ASC, id ASC
  LIMIT 50
`;

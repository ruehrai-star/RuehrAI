import { Injectable, Logger } from "@nestjs/common";
import { AnalysisRegion } from "../analysis/types";
import { throwIfAborted } from "../analysis/run-abort";
import { emptyToNull, toCoord } from "../customer/values";
import { parseRegionGeometry, RegionGeometry } from "../geo/region-geometry";
import { DatabaseService, featuresReadQuery } from "../database/database.service";
import {
  isFeaturesAccessDenied,
  isGeoCatalogUnavailable,
  isMissingFeaturesRelation,
} from "../database/pg-error";
import { Grain } from "../target-region/dto";
import { pushAll, yieldEventLoop } from "../common/safe-array";
import { gemeindeDisplayNameFromAgs, officialAgsKey } from "../geo/geo-catalog";
import { municipalityAgsFrom } from "../analysis/yearly-series";
import {
  AREA_CANDIDATE_LIMIT,
  AreaCandidate,
  AreaCandidateSqlRow,
  AreaKind,
  addressCandidateQuery,
  areaCandidateQuery,
  assertCandidateQueryArity,
  CandidateQuery,
  geoAddressCandidateQuery,
  grid100CandidateQuery,
  hamburgStadtteilFallbackQuery,
  isAreaKind,
  isLorPlrKey,
  koelnQuartierCandidateQuery,
  lorFeatureCandidateQuery,
  lorPlrCatalogQuery,
  lorPlrFeatureCandidateQuery,
  municipalityNameQuery,
  parentMemberships,
  selectCatalogHits,
  skipAddressAndGridForRegion,
  stampCandidateTargetRegion,
  targetRegionKeyOf,
  teilCatalogQuery,
} from "./area-candidates";
import { displayAreaName } from "./hit-display";

const GRAIN_SET = new Set<string>(["address", "grid100", "plz8", "plz5", "ags", "ags5", "other"]);

export interface AreaCandidateLoad {
  items: AreaCandidate[];
  truncated: boolean;
}

@Injectable()
export class AreaCandidateService {
  private readonly logger = new Logger(AreaCandidateService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Catalog Teilflächen inside the Zielregion (all kinds). Never the region
   * geoKey itself. Dataset ranking later picks the native Fläche per metric.
   * Address is skipped when `geo.geo_ref_address` / Brain has no rows.
   * Berlin 2021 PLR (`lor:plr:*`) wins over 2006 LOR; Köln `koeln:sq:*` is quartier.
   */
  async load(regions: AnalysisRegion[], signal?: AbortSignal): Promise<AreaCandidateLoad> {
    if (regions.length === 0) return { items: [], truncated: false };
    const seen = new Set<string>();
    const collected: AreaCandidate[] = [];
    let truncated = false;
    try {
      for (const region of regions) {
        throwIfAborted(signal);
        const loaded = await this.loadRegion(region);
        await yieldEventLoop();
        if (loaded.truncated) truncated = true;
        const regionKey = targetRegionKeyOf(region);
        const stamped = loaded.items.map((item) => stampCandidateTargetRegion(item, regionKey));
        pushAll(collected, selectCatalogHits(stamped, [region, ...regions]));
      }
      const out: AreaCandidate[] = [];
      for (const candidate of collected) {
        if (seen.has(candidate.id)) continue;
        seen.add(candidate.id);
        out.push(candidate);
      }
      return { items: await this.withMunicipalityNames(out), truncated };
    } catch (error) {
      if (isGeoCatalogUnavailable(error) || isMissingFeaturesRelation(error) || isFeaturesAccessDenied(error)) {
        this.logger.log(`Area-candidate catalog read missed (${messageOf(error)}).`);
        return { items: [], truncated: false };
      }
      throw error;
    }
  }

  private async loadRegion(region: AnalysisRegion): Promise<AreaCandidateLoad> {
    const skipFine = skipAddressAndGridForRegion(region);
    const geoAddress = skipFine
      ? { items: [], truncated: false }
      : await this.readOptionalQuery(geoAddressCandidateQuery(region));
    const address = skipFine
      ? { items: [], truncated: false }
      : await this.readOptionalQuery(addressCandidateQuery(region));
    const grid = skipFine
      ? { items: [], truncated: false }
      : await this.readOptionalQuery(grid100CandidateQuery(region));
    const lorPlrCatalog = await this.readOptionalQuery(lorPlrCatalogQuery(region));
    const lorPlrFeatures = await this.readOptionalQuery(lorPlrFeatureCandidateQuery(region));
    const quartier = await this.readOptionalQuery(koelnQuartierCandidateQuery(region));
    const catalog = await this.readCatalog(region);
    const plrItems = [...lorPlrCatalog.items, ...lorPlrFeatures.items];
    const hasPlr = plrItems.some((item) => isLorPlrKey(item.geoKey));
    const lor2006 = hasPlr
      ? { items: [], truncated: false }
      : await this.readOptionalQuery(lorFeatureCandidateQuery(region));
    const hamburg = await this.readOptionalQuery(hamburgStadtteilFallbackQuery(region));
    const combined = [
      ...geoAddress.items,
      ...address.items,
      ...grid.items,
      ...plrItems,
      ...quartier.items,
      ...catalog.items,
      ...lor2006.items,
      ...hamburg.items,
    ];
    const truncated =
      geoAddress.truncated ||
      address.truncated ||
      grid.truncated ||
      lorPlrCatalog.truncated ||
      lorPlrFeatures.truncated ||
      quartier.truncated ||
      catalog.truncated ||
      lor2006.truncated ||
      hamburg.truncated ||
      geoAddress.items.length >= AREA_CANDIDATE_LIMIT ||
      address.items.length >= AREA_CANDIDATE_LIMIT ||
      grid.items.length >= AREA_CANDIDATE_LIMIT ||
      plrItems.length >= AREA_CANDIDATE_LIMIT ||
      quartier.items.length >= AREA_CANDIDATE_LIMIT ||
      catalog.items.length >= AREA_CANDIDATE_LIMIT ||
      lor2006.items.length >= AREA_CANDIDATE_LIMIT ||
      hamburg.items.length >= AREA_CANDIDATE_LIMIT;
    return { items: combined, truncated };
  }

  private async readCatalog(region: AnalysisRegion): Promise<AreaCandidateLoad> {
    const membership = parentMemberships(region);
    if (membership.grains.length > 0) {
      const teil = await this.readTeil(region);
      if (teil) return teil;
    }
    return this.readIntersectFallback(region);
  }

  private async readTeil(region: AnalysisRegion): Promise<AreaCandidateLoad | null> {
    try {
      return await this.readQuery(teilCatalogQuery(region, "prefer"));
    } catch (error) {
      if (isUndefinedColumn(error)) {
        try {
          return await this.readQuery(teilCatalogQuery(region, "legacy"));
        } catch (legacyError) {
          if (isMissingTeilCatalog(legacyError) || isOptionalTeilJoinMissing(legacyError)) return null;
          throw legacyError;
        }
      }
      if (isMissingTeilCatalog(error) || isOptionalTeilJoinMissing(error)) return null;
      throw error;
    }
  }

  private async readIntersectFallback(region: AnalysisRegion): Promise<AreaCandidateLoad> {
    try {
      return await this.readQuery(areaCandidateQuery(region, "prefer"));
    } catch (error) {
      if (isUndefinedColumn(error)) {
        return this.readQuery(areaCandidateQuery(region, "legacy"));
      }
      throw error;
    }
  }

  private async readOptionalQuery(query: CandidateQuery): Promise<AreaCandidateLoad> {
    try {
      return await this.readQuery(query);
    } catch (error) {
      if (
        isGeoCatalogUnavailable(error) ||
        isMissingFeaturesRelation(error) ||
        isFeaturesAccessDenied(error) ||
        isUndefinedColumn(error)
      ) {
        this.logger.log(`Optional area-candidate read missed (${messageOf(error)}).`);
        return { items: [], truncated: false };
      }
      throw error;
    }
  }

  private async readQuery(query: CandidateQuery): Promise<AreaCandidateLoad> {
    assertCandidateQueryArity(query);
    const result = await featuresReadQuery(this.db)<AreaCandidateSqlRow>(query.sql, query.params);
    const items: AreaCandidate[] = [];
    for (const row of result.rows) {
      const candidate = toCandidate(row);
      if (candidate) items.push(candidate);
      if (items.length % 50 === 0) await yieldEventLoop();
    }
    return { items, truncated: result.rows.length >= AREA_CANDIDATE_LIMIT };
  }

  private async withMunicipalityNames(items: AreaCandidate[]): Promise<AreaCandidate[]> {
    if (items.length === 0) return items;
    const keys = uniqueAgs(
      items.map((item) => municipalityAgsFrom(item) ?? officialAgsKey(item.ags)).filter((value): value is string => Boolean(value)),
    );
    const fallback = (item: AreaCandidate): string | null =>
      gemeindeDisplayNameFromAgs(item.ags) ?? gemeindeDisplayNameFromAgs(item.geoKey);
    if (keys.length === 0) {
      return items.map((item) => ({ ...item, municipalityName: item.municipalityName ?? fallback(item) }));
    }
    try {
      const query = municipalityNameQuery(keys);
      assertCandidateQueryArity(query);
      const result = await featuresReadQuery(this.db)<{ geo_ags: string | null; name: string | null }>(
        query.sql,
        query.params,
      );
      const names = new Map<string, string>();
      for (const row of result.rows) {
        const ags = row.geo_ags?.trim();
        const name = emptyToNull(row.name);
        if (ags && name) names.set(ags, name);
      }
      return items.map((item) => {
        const ags = municipalityAgsFrom(item) ?? officialAgsKey(item.ags);
        return {
          ...item,
          municipalityName: (ags ? names.get(ags) : undefined) ?? item.municipalityName ?? fallback(item),
        };
      });
    } catch (error) {
      this.logger.log(`Municipality-name catalog read missed (${messageOf(error)}).`);
      return items.map((item) => ({ ...item, municipalityName: item.municipalityName ?? fallback(item) }));
    }
  }
}

function toCandidate(row: AreaCandidateSqlRow): AreaCandidate | null {
  const geoKey = row.geo_key?.trim() ?? "";
  const grain = asGrain(row.grain);
  const kind = asKind(row.kind);
  if (!geoKey || !grain || !kind) return null;
  const name = row.name?.trim() || null;
  const geometry = parseOptionalGeometry(row.geometry_geojson);
  const draft: AreaCandidate = {
    id: `${grain}:${geoKey}`,
    geoKey,
    grain,
    kind,
    title: name || `${kind} ${geoKey}`,
    name,
    ags: row.ags?.trim() || null,
    plz: row.plz?.trim() || null,
    lon: toCoord(row.lon),
    lat: toCoord(row.lat),
    geometry: geometry,
    geometryUnavailableReason: geometry ? null : "Die Fläche kann noch nicht gezeichnet werden.",
  };
  const display = displayAreaName(draft);
  return { ...draft, title: display, name: display };
}

function parseOptionalGeometry(raw: string | null | undefined): RegionGeometry | null {
  if (!raw || !raw.trim()) return null;
  try {
    return parseRegionGeometry(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function asGrain(value: string | null): Grain | null {
  if (!value || !GRAIN_SET.has(value)) return null;
  return value as Grain;
}

function asKind(value: string | null): AreaKind | null {
  return isAreaKind(value) ? value : null;
}

function isMissingTeilCatalog(error: unknown): boolean {
  if (!isMissingFeaturesRelation(error) && !isGeoCatalogUnavailable(error)) return false;
  return /zielregion_teil/i.test(messageOf(error));
}

function isOptionalTeilJoinMissing(error: unknown): boolean {
  if (!isMissingFeaturesRelation(error) && !isUndefinedColumn(error) && !isGeoCatalogUnavailable(error)) {
    return false;
  }
  return /geo_ref_lor|location_feature_docs|lor_level|valid_to/i.test(messageOf(error));
}

function isUndefinedColumn(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return (error as { code?: unknown }).code === "42703";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function uniqueAgs(values: string[]): string[] {
  return [...new Set(values)];
}

import { Injectable, Logger } from "@nestjs/common";
import { AnalysisRegion } from "../analysis/types";
import { toCoord } from "../customer/values";
import { DatabaseService } from "../database/database.service";
import {
  isFeaturesAccessDenied,
  isGeoCatalogUnavailable,
  isMissingFeaturesRelation,
} from "../database/pg-error";
import { Grain } from "../target-region/dto";
import {
  AREA_CANDIDATE_LIMIT,
  AreaCandidate,
  AreaCandidateSqlRow,
  AreaKind,
  areaCandidateParams,
  buildAddressCandidateSql,
  buildAreaCandidateSql,
  buildGrid100CandidateSql,
  buildHamburgStadtteilFallbackSql,
  buildLorFeatureCandidateSql,
  buildTeilCatalogSql,
  featureCandidateParams,
  hamburgFallbackParams,
  isAreaKind,
  lorCandidateParams,
  parentMemberships,
  selectFinestHits,
} from "./area-candidates";

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
   * Finest Teilflächen inside the Zielregion. Never the region geoKey itself.
   * Address is skipped when Brain has no docs; grid100 is tried next.
   */
  async load(regions: AnalysisRegion[]): Promise<AreaCandidateLoad> {
    if (regions.length === 0) return { items: [], truncated: false };
    const seen = new Set<string>();
    const collected: AreaCandidate[] = [];
    let truncated = false;
    try {
      for (const region of regions) {
        const loaded = await this.loadRegion(region);
        if (loaded.truncated) truncated = true;
        collected.push(...selectFinestHits(loaded.items, [region, ...regions]));
      }
      const out: AreaCandidate[] = [];
      for (const candidate of collected) {
        if (seen.has(candidate.id)) continue;
        seen.add(candidate.id);
        out.push(candidate);
      }
      return { items: out, truncated };
    } catch (error) {
      if (isGeoCatalogUnavailable(error) || isMissingFeaturesRelation(error) || isFeaturesAccessDenied(error)) {
        this.logger.log(`Area-candidate catalog read missed (${messageOf(error)}).`);
        return { items: [], truncated: false };
      }
      throw error;
    }
  }

  private async loadRegion(region: AnalysisRegion): Promise<AreaCandidateLoad> {
    const address = await this.readOptional(buildAddressCandidateSql(), featureCandidateParams(region));
    const grid = await this.readOptional(buildGrid100CandidateSql(), featureCandidateParams(region));
    const catalog = await this.readCatalog(region);
    const lor = await this.readOptional(buildLorFeatureCandidateSql(), lorCandidateParams(region));
    const hamburg = await this.readOptional(buildHamburgStadtteilFallbackSql(), hamburgFallbackParams(region));
    const combined = [...address.items, ...grid.items, ...catalog.items, ...lor.items, ...hamburg.items];
    const truncated =
      address.truncated ||
      grid.truncated ||
      catalog.truncated ||
      lor.truncated ||
      hamburg.truncated ||
      address.items.length >= AREA_CANDIDATE_LIMIT ||
      grid.items.length >= AREA_CANDIDATE_LIMIT ||
      catalog.items.length >= AREA_CANDIDATE_LIMIT ||
      lor.items.length >= AREA_CANDIDATE_LIMIT ||
      hamburg.items.length >= AREA_CANDIDATE_LIMIT;
    return { items: combined, truncated };
  }

  private async readCatalog(region: AnalysisRegion): Promise<AreaCandidateLoad> {
    const membership = parentMemberships(region);
    if (membership.grains.length > 0) {
      const teil = await this.readTeil(region, membership.grains, membership.ids);
      if (teil) return teil;
    }
    return this.readIntersectFallback(region);
  }

  private async readTeil(
    region: AnalysisRegion,
    grains: string[],
    ids: string[],
  ): Promise<AreaCandidateLoad | null> {
    const exclude = [
      region.geoKey?.trim(),
      region.ags?.trim(),
      region.plz?.trim(),
    ].filter((value): value is string => Boolean(value));
    try {
      return await this.readSql(buildTeilCatalogSql("prefer"), [grains, ids, exclude]);
    } catch (error) {
      if (isUndefinedColumn(error)) {
        try {
          return await this.readSql(buildTeilCatalogSql("legacy"), [grains, ids, exclude]);
        } catch (legacyError) {
          if (isMissingTeilCatalog(legacyError)) return null;
          throw legacyError;
        }
      }
      if (isMissingTeilCatalog(error)) return null;
      throw error;
    }
  }

  private async readIntersectFallback(region: AnalysisRegion): Promise<AreaCandidateLoad> {
    try {
      return await this.readSql(buildAreaCandidateSql("prefer"), areaCandidateParams(region));
    } catch (error) {
      if (isUndefinedColumn(error)) {
        return this.readSql(buildAreaCandidateSql("legacy"), areaCandidateParams(region));
      }
      throw error;
    }
  }

  private async readOptional(sql: string, params: unknown[]): Promise<AreaCandidateLoad> {
    try {
      return await this.readSql(sql, params);
    } catch (error) {
      if (isGeoCatalogUnavailable(error) || isMissingFeaturesRelation(error) || isFeaturesAccessDenied(error)) {
        this.logger.log(`Optional area-candidate read missed (${messageOf(error)}).`);
        return { items: [], truncated: false };
      }
      throw error;
    }
  }

  private async readSql(sql: string, params: unknown[]): Promise<AreaCandidateLoad> {
    const result = await this.db.queryReadingFeatures<AreaCandidateSqlRow>(sql, params);
    const items: AreaCandidate[] = [];
    for (const row of result.rows) {
      const candidate = toCandidate(row);
      if (candidate) items.push(candidate);
    }
    return { items, truncated: result.rows.length >= AREA_CANDIDATE_LIMIT };
  }
}

function toCandidate(row: AreaCandidateSqlRow): AreaCandidate | null {
  const geoKey = row.geo_key?.trim() ?? "";
  const grain = asGrain(row.grain);
  const kind = asKind(row.kind);
  if (!geoKey || !grain || !kind) return null;
  const name = row.name?.trim() || null;
  return {
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
  };
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

function isUndefinedColumn(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return (error as { code?: unknown }).code === "42703";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

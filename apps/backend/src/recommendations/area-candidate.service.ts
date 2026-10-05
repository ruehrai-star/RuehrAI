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
  buildAreaCandidateSql,
  isRegionAnchor,
} from "./area-candidates";

const GRAIN_SET = new Set<string>(["address", "grid100", "plz8", "plz5", "ags", "ags5", "other"]);
const KIND_SET = new Set<string>(["ortsteil", "stadtteil", "bezirk", "stadtbezirk", "plz", "gemeinde"]);

export interface AreaCandidateLoad {
  items: AreaCandidate[];
  truncated: boolean;
}

@Injectable()
export class AreaCandidateService {
  private readonly logger = new Logger(AreaCandidateService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Sub-areas inside the Zielregionen. Never the region geoKey itself.
   */
  async load(regions: AnalysisRegion[]): Promise<AreaCandidateLoad> {
    if (regions.length === 0) return { items: [], truncated: false };
    const seen = new Set<string>();
    const items: AreaCandidate[] = [];
    let truncated = false;
    try {
      for (const region of regions) {
        const result = await this.db.queryReadingFeatures<AreaCandidateSqlRow>(
          buildAreaCandidateSql(),
          areaCandidateParams(region),
        );
        if (result.rows.length >= AREA_CANDIDATE_LIMIT) truncated = true;
        for (const row of result.rows) {
          const candidate = toCandidate(row);
          if (!candidate) continue;
          if (isRegionAnchor(candidate, region)) continue;
          if (regions.some((item) => isRegionAnchor(candidate, item))) continue;
          if (seen.has(candidate.id)) continue;
          seen.add(candidate.id);
          items.push(candidate);
        }
      }
      return { items, truncated };
    } catch (error) {
      if (isGeoCatalogUnavailable(error) || isMissingFeaturesRelation(error) || isFeaturesAccessDenied(error)) {
        this.logger.log(`Area-candidate catalog read missed (${messageOf(error)}).`);
        return { items: [], truncated: false };
      }
      throw error;
    }
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
  if (!value || !KIND_SET.has(value)) return null;
  return value as AreaKind;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

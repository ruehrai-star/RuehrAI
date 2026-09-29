import { Injectable } from "@nestjs/common";
import {
  FeatureRelation,
  chooseRelation,
  relationIsSearchable,
} from "../analysis/brain-search.sql";
import { DatabaseService } from "../database/database.service";
import { isFeaturesAccessDenied, isMissingFeaturesRelation } from "../database/pg-error";
import { toCoord } from "../customer/values";
import { AnalysisRegion } from "../analysis/types";
import { CANDIDATE_ROW_LIMIT, buildCandidateSql, regionQueryParams } from "./candidates.sql";
import { CandidateRow } from "./types";

interface CandidateSqlRow {
  id: string;
  geo_key: string | null;
  grain: string;
  name: string | null;
  ref_period: string | null;
  title: string | null;
  metadata: unknown;
  lon: number | string | null;
  lat: number | string | null;
}

export interface CandidateLoad {
  rows: CandidateRow[];
  truncated: boolean;
}

@Injectable()
export class CandidateSearchService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * In-window Brain rows for the target region. Uses the same features
   * reader as Musteranalyse (`backend_ro_features` when that role exists).
   */
  async load(region: AnalysisRegion, months: string[]): Promise<CandidateLoad> {
    if (months.length === 0) return { rows: [], truncated: false };
    const chosen = await this.resolveRelation();
    if (!chosen || !chosen.columns.has("ref_period")) {
      return { rows: [], truncated: false };
    }
    const [ags, plz, geoKey, label] = regionQueryParams(region);
    try {
      const result = await this.db.queryReadingFeatures<CandidateSqlRow>(
        buildCandidateSql(chosen.relation, chosen.columns),
        [ags, plz, geoKey, label, months],
      );
      return {
        rows: result.rows.map(toCandidate),
        truncated: result.rows.length >= CANDIDATE_ROW_LIMIT,
      };
    } catch (error) {
      if (isMissingFeaturesRelation(error) || isFeaturesAccessDenied(error)) {
        return { rows: [], truncated: false };
      }
      throw error;
    }
  }

  private async resolveRelation(): Promise<{
    relation: FeatureRelation;
    columns: ReadonlySet<string>;
  } | null> {
    const tableColumns = await this.columnSet("location_feature_docs");
    const viewColumns = await this.columnSet("v_location_search");
    return chooseRelation(tableColumns, viewColumns);
  }

  private async columnSet(relation: FeatureRelation): Promise<ReadonlySet<string> | null> {
    try {
      const result = await this.db.queryReadingFeatures<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'features'
           AND table_name = $1`,
        [relation],
      );
      if (result.rows.length === 0) return null;
      const columns = new Set(result.rows.map((row) => row.column_name));
      return relationIsSearchable(columns) ? columns : null;
    } catch (error) {
      if (isMissingFeaturesRelation(error) || isFeaturesAccessDenied(error)) return null;
      throw error;
    }
  }
}

function toCandidate(row: CandidateSqlRow): CandidateRow {
  return {
    id: row.id,
    geoKey: row.geo_key ?? "",
    grain: row.grain,
    name: row.name,
    title: (row.title ?? row.name ?? row.geo_key ?? row.id).trim(),
    refPeriod: row.ref_period,
    metadata: row.metadata,
    lon: toCoord(row.lon),
    lat: toCoord(row.lat),
  };
}

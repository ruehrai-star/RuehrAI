import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { emptyToNull, toCoord, toIso, toRevenue } from "../customer/values";
import { fillMissingCatalogDisplay } from "../geo/catalog-display";
import { GeoCatalogService } from "../geo/geo-catalog.service";
import { isCatalogLevel } from "../geo/geo-catalog";
import { boundsFromRow, geometryFromUnknown } from "../geo/region-geometry";
import { Grain } from "../target-region/dto";
import { BrainSearchService } from "./brain-search.service";
import {
  PATTERN_NOT_FOUND,
  REGION_MISSING,
  REVENUE_INSUFFICIENT,
  RUN_NOT_FOUND,
} from "./messages";
import { PatternService } from "./pattern.service";
import {
  hasAdjacentRevenue,
  latestPoints,
  monthChanges,
  revenueDirection,
} from "./revenue-series";
import {
  AnalysisBrain,
  AnalysisInput,
  AnalysisPattern,
  AnalysisPatternResponse,
  AnalysisRegion,
  AnalysisRun,
  AnalysisStoreInput,
  analysisRegions,
} from "./types";
import { asOfFrom } from "./yearly-series";
import { YearlySeriesService } from "./yearly-series.service";

interface RegionRow {
  label: string;
  grain: Grain | null;
  geo_key: string | null;
  level?: string | null;
  parent_label?: string | null;
  ags: string | null;
  plz: string | null;
  lon: number | string | null;
  lat: number | string | null;
  bounds_west?: number | string | null;
  bounds_south?: number | string | null;
  bounds_east?: number | string | null;
  bounds_north?: number | string | null;
  geometry?: unknown;
  updated_at: Date | string;
}

interface StoreRevenueRow {
  id: string;
  label: string | null;
  street: string;
  postal_code: string;
  city: string;
  lon: number | string | null;
  lat: number | string | null;
  year: number | null;
  month: number | null;
  revenue_eur: string | number | null;
}

interface RunRow {
  id: string;
  status: "completed";
  input: AnalysisInput;
  brain: AnalysisBrain;
  pattern: AnalysisPattern;
  created_at: Date | string;
}

@Injectable()
export class AnalysisService {
  constructor(
    private readonly db: DatabaseService,
    private readonly brain: BrainSearchService,
    private readonly patterns: PatternService,
    private readonly geoCatalog: GeoCatalogService,
    private readonly yearlySeries: YearlySeriesService,
  ) {}

  async getInput(userId: string): Promise<AnalysisInput> {
    return this.loadInput(userId);
  }

  /**
   * Snapshots region, stores, and revenue, searches Brain, and stores the
   * pattern on the run. Top-3 ranking reads that pattern from
   * `POST /recommendations` and does not belong in this service.
   */
  async createRun(userId: string): Promise<AnalysisRun> {
    const input = await this.loadInput(userId);
    const brain = await this.brain.search(input);
    const derived = await this.patterns.derive(input, brain.facts);
    const pattern = await this.attachYearlySeries(derived, input);
    const inserted = await this.db.query<{ id: string; created_at: Date | string }>(
      `INSERT INTO app.analysis_runs (user_id, status, input, brain, pattern)
       VALUES ($1::bigint, 'completed', $2::jsonb, $3::jsonb, $4::jsonb)
       RETURNING id::text AS id, created_at`,
      [userId, JSON.stringify(input), JSON.stringify(brain), JSON.stringify(pattern)],
    );
    const row = inserted.rows[0];
    if (!row) throw new NotFoundException(RUN_NOT_FOUND);
    return {
      id: row.id,
      status: "completed",
      createdAt: toIso(row.created_at),
      input,
      brain,
      pattern,
    };
  }

  async getRun(userId: string, runId: string): Promise<AnalysisRun> {
    const result = await this.db.query<RunRow>(
      `SELECT id::text AS id, status, input, brain, pattern, created_at
       FROM app.analysis_runs
       WHERE id = $1::bigint
         AND user_id = $2::bigint`,
      [runId, userId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException(RUN_NOT_FOUND);
    return toRun({ ...row, pattern: await this.withYearlySeries(row.pattern, row.input) });
  }

  async latestPattern(userId: string): Promise<AnalysisPatternResponse> {
    const result = await this.db.query<RunRow>(
      `SELECT id::text AS id, status, input, brain, pattern, created_at
       FROM app.analysis_runs
       WHERE user_id = $1::bigint
         AND status = 'completed'
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException(PATTERN_NOT_FOUND);
    return {
      runId: row.id,
      createdAt: toIso(row.created_at),
      pattern: await this.withYearlySeries(row.pattern, row.input),
    };
  }

  private async attachYearlySeries(pattern: AnalysisPattern, input: AnalysisInput): Promise<AnalysisPattern> {
    const yearlySeries = await this.yearlySeries.build(analysisRegions(input), asOfFrom(input.capturedAt));
    return { ...pattern, yearlySeries };
  }

  private async withYearlySeries(pattern: AnalysisPattern, input: AnalysisInput | undefined): Promise<AnalysisPattern> {
    if (Array.isArray(pattern.yearlySeries)) return pattern;
    if (!input?.region && !(input?.regions && input.regions.length > 0)) {
      return { ...pattern, yearlySeries: [] };
    }
    return this.attachYearlySeries(pattern, input);
  }

  private async loadInput(userId: string): Promise<AnalysisInput> {
    const regionResult = await this.db.query<RegionRow>(
      `SELECT label, grain, geo_key, level, parent_label, ags, plz, lon, lat,
              bounds_west, bounds_south, bounds_east, bounds_north, geometry, updated_at
       FROM app.target_regions
       WHERE user_id = $1::bigint
       ORDER BY created_at DESC, id DESC`,
      [userId],
    );
    const regionRows = regionResult.rows;
    if (regionRows.length === 0) throw new NotFoundException(REGION_MISSING);
    const regions = await Promise.all(
      regionRows.map((row) =>
        fillMissingCatalogDisplay(
          toRegion(row),
          (query) => this.geoCatalog.search(query),
          (keys) => this.geoCatalog.lookupAdminNames(keys),
        ),
      ),
    );
    const region = regions[0];
    if (!region) throw new NotFoundException(REGION_MISSING);

    const storeResult = await this.db.query<StoreRevenueRow>(
      `SELECT s.id::text AS id,
              s.label,
              s.street,
              s.postal_code,
              s.city,
              s.lon,
              s.lat,
              r.year,
              r.month,
              r.revenue_eur
       FROM app.store_locations s
       LEFT JOIN app.store_monthly_revenue r ON r.store_location_id = s.id
       WHERE s.user_id = $1::bigint
       ORDER BY s.created_at ASC, s.id ASC, r.year ASC, r.month ASC`,
      [userId],
    );
    const stores = groupStores(storeResult.rows);
    if (!stores.some((store) => hasAdjacentRevenue(store.points))) {
      throw new BadRequestException(REVENUE_INSUFFICIENT);
    }

    const withChanges = stores.map((store) => {
      const points = latestPoints(store.points);
      const changes = monthChanges(points);
      return { ...store, points, changes };
    });
    return {
      region,
      regions,
      stores: withChanges,
      revenueDirection: revenueDirection(withChanges.flatMap((store) => store.changes)),
      capturedAt: new Date().toISOString(),
    };
  }
}

function groupStores(rows: StoreRevenueRow[]): AnalysisStoreInput[] {
  const stores: AnalysisStoreInput[] = [];
  for (const row of rows) {
    let store = stores.find((item) => item.id === row.id);
    if (!store) {
      store = {
        id: row.id,
        label: row.label,
        street: row.street,
        postalCode: row.postal_code,
        city: row.city,
        lon: toCoord(row.lon),
        lat: toCoord(row.lat),
        points: [],
        changes: [],
      };
      stores.push(store);
    }
    if (row.year === null || row.month === null) continue;
    store.points.push({
      year: Number(row.year),
      month: Number(row.month),
      revenueEur: toRevenue(row.revenue_eur),
    });
  }
  return stores;
}

function toRegion(row: RegionRow): AnalysisRegion {
  return {
    label: row.label,
    grain: row.grain,
    geoKey: row.geo_key,
    level: isCatalogLevel(row.level) ? row.level : null,
    parentLabel: emptyToNull(row.parent_label),
    ags: row.ags,
    plz: row.plz,
    lon: toCoord(row.lon),
    lat: toCoord(row.lat),
    bounds: boundsFromRow(row),
    geometry: geometryFromUnknown(row.geometry),
    updatedAt: toIso(row.updated_at),
  };
}

function toRun(row: RunRow): AnalysisRun {
  return {
    id: row.id,
    status: "completed",
    createdAt: toIso(row.created_at),
    input: row.input,
    brain: row.brain,
    pattern: row.pattern,
  };
}

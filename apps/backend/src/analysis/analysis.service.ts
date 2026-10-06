import { BadRequestException, HttpException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { emptyToNull, toCoord, toIso, toRevenue } from "../customer/values";
import { fillMissingCatalogDisplay } from "../geo/catalog-display";
import { GeoCatalogService } from "../geo/geo-catalog.service";
import { isCatalogLevel } from "../geo/geo-catalog";
import { boundsFromRow, geometryFromUnknown } from "../geo/region-geometry";
import { Grain } from "../target-region/dto";
import { BrainSearchService } from "./brain-search.service";
import {
  PATTERN_FOR_REGION_NOT_FOUND,
  PATTERN_NOT_FOUND,
  REGION_MISSING,
  REVENUE_INSUFFICIENT,
  RUN_FAILED,
  RUN_NOT_FOUND,
} from "./messages";
import { PatternService } from "./pattern.service";
import {
  filterYearlySeries,
  findSnapshotRegion,
  matchingGeoKeys,
  toPatternRegion,
} from "./region-match";
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
  AnalysisRunStatus,
  AnalysisStoreInput,
  analysisRegions,
} from "./types";
import { asOfFrom } from "./yearly-series";
import { YearlySeriesService } from "./yearly-series.service";
import { RecommendationsService } from "../recommendations/recommendations.service";

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
  status: string;
  input: AnalysisInput;
  brain: AnalysisBrain;
  pattern: AnalysisPattern;
  created_at: Date | string;
  started_at?: Date | string | null;
  completed_at?: Date | string | null;
  failure_reason?: string | null;
}

const EMPTY_BRAIN: AnalysisBrain = {
  mode: "sql",
  vectorUnavailableReason: null,
  factCount: 0,
  facts: [],
};

const EMPTY_PATTERN: AnalysisPattern = {
  source: "heuristic",
  summary: "",
  revenueDirection: "flat",
  criteria: [],
};

@Injectable()
export class AnalysisService {
  constructor(
    private readonly db: DatabaseService,
    private readonly brain: BrainSearchService,
    private readonly patterns: PatternService,
    private readonly geoCatalog: GeoCatalogService,
    private readonly yearlySeries: YearlySeriesService,
    private readonly recommendations: RecommendationsService,
  ) {}

  async getInput(userId: string): Promise<AnalysisInput> {
    return this.loadInput(userId);
  }

  /**
   * Snapshots region, stores, and revenue, searches Brain, stores the
   * pattern, and persists a recommendation set bound to this runId when
   * Zielregion(en) are marked. GET never computes. Status is queued on
   * insert, running during Brain/pattern work and set ranking, then
   * completed only after the set is stored — or failed (with
   * failureReason) if pattern or set computation throws. Marking another
   * Zielregion later does not start a run.
   */
  async createRun(userId: string): Promise<AnalysisRun> {
    const input = await this.loadInput(userId);
    const inserted = await this.db.query<{ id: string; created_at: Date | string }>(
      `INSERT INTO app.analysis_runs (user_id, status, input, brain, pattern)
       VALUES ($1::bigint, 'queued', $2::jsonb, $3::jsonb, $4::jsonb)
       RETURNING id::text AS id, created_at`,
      [userId, JSON.stringify(input), JSON.stringify(EMPTY_BRAIN), JSON.stringify(EMPTY_PATTERN)],
    );
    const row = inserted.rows[0];
    if (!row) throw new NotFoundException(RUN_NOT_FOUND);
    const createdAt = toIso(row.created_at);
    try {
      const started = await this.db.query<{ started_at: Date | string | null }>(
        `UPDATE app.analysis_runs
            SET status = 'running',
                started_at = COALESCE(started_at, now())
          WHERE id = $1::bigint
            AND user_id = $2::bigint
          RETURNING started_at`,
        [row.id, userId],
      );
      const brain = await this.brain.search(input);
      const derived = await this.patterns.derive(input, brain.facts);
      const pattern = await this.attachYearlySeries(derived, input);
      await this.db.query(
        `UPDATE app.analysis_runs
            SET brain = $3::jsonb,
                pattern = $4::jsonb
          WHERE id = $1::bigint
            AND user_id = $2::bigint
            AND status = 'running'`,
        [row.id, userId, JSON.stringify(brain), JSON.stringify(pattern)],
      );
      if (analysisRegions(input).length > 0) {
        await this.recommendations.create(userId, row.id);
      }
      const finished = await this.db.query<{ started_at: Date | string | null; completed_at: Date | string | null }>(
        `UPDATE app.analysis_runs
            SET status = 'completed',
                brain = $3::jsonb,
                pattern = $4::jsonb,
                completed_at = now(),
                failure_reason = NULL
          WHERE id = $1::bigint
            AND user_id = $2::bigint
          RETURNING started_at, completed_at`,
        [row.id, userId, JSON.stringify(brain), JSON.stringify(pattern)],
      );
      const times = finished.rows[0];
      return {
        id: row.id,
        status: "completed",
        createdAt,
        startedAt: toOptionalIso(started.rows[0]?.started_at ?? times?.started_at ?? row.created_at),
        completedAt: toOptionalIso(times?.completed_at ?? new Date()),
        failureReason: null,
        input,
        brain,
        pattern,
      };
    } catch (error) {
      await this.markFailed(userId, row.id, failureReasonOf(error));
      throw error;
    }
  }

  async getRun(userId: string, runId: string): Promise<AnalysisRun> {
    const result = await this.db.query<RunRow>(
      `SELECT id::text AS id, status, input, brain, pattern, created_at,
              started_at, completed_at, failure_reason
       FROM app.analysis_runs
       WHERE id = $1::bigint
         AND user_id = $2::bigint`,
      [runId, userId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException(RUN_NOT_FOUND);
    if (asRunStatus(row.status) !== "completed") return toRun(row);
    return toRun({ ...row, pattern: await this.withYearlySeries(row.pattern, row.input) });
  }

  async latestPattern(userId: string, geoKey?: string): Promise<AnalysisPatternResponse> {
    const row = await this.loadLatestRun(userId, geoKey);
    if (!row) {
      throw new NotFoundException(geoKey ? PATTERN_FOR_REGION_NOT_FOUND : PATTERN_NOT_FOUND);
    }
    const region = findSnapshotRegion(row.input, geoKey);
    if (!region) {
      throw new NotFoundException(geoKey ? PATTERN_FOR_REGION_NOT_FOUND : PATTERN_NOT_FOUND);
    }
    const inputForSeries =
      geoKey && row.input
        ? { ...row.input, region, regions: [region] }
        : row.input;
    let pattern = await this.withYearlySeries(row.pattern, inputForSeries);
    if (geoKey) {
      pattern = { ...pattern, yearlySeries: filterYearlySeries(pattern.yearlySeries, geoKey) };
    }
    return {
      runId: row.id,
      createdAt: toIso(row.created_at),
      region: toPatternRegion(region),
      pattern,
    };
  }

  private async loadLatestRun(userId: string, geoKey?: string): Promise<RunRow | undefined> {
    if (!geoKey) {
      const result = await this.db.query<RunRow>(
        `SELECT id::text AS id, status, input, brain, pattern, created_at,
                started_at, completed_at, failure_reason
         FROM app.analysis_runs
         WHERE user_id = $1::bigint
           AND status = 'completed'
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [userId],
      );
      return result.rows[0];
    }

    const keys = matchingGeoKeys(geoKey);
    const result = await this.db.query<RunRow>(
      `SELECT id::text AS id, status, input, brain, pattern, created_at,
              started_at, completed_at, failure_reason
       FROM app.analysis_runs
       WHERE user_id = $1::bigint
         AND status = 'completed'
         AND (
           COALESCE(input#>>'{region,geoKey}', '') = ANY($2::text[])
           OR EXISTS (
             SELECT 1
             FROM jsonb_array_elements(COALESCE(input->'regions', '[]'::jsonb)) AS r
             WHERE COALESCE(r->>'geoKey', '') = ANY($2::text[])
           )
         )
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [userId, keys],
    );
    return result.rows[0];
  }

  private async attachYearlySeries(pattern: AnalysisPattern, input: AnalysisInput): Promise<AnalysisPattern> {
    const yearlySeries = await this.yearlySeries.build(analysisRegions(input), asOfFrom(input.capturedAt));
    return { ...pattern, yearlySeries };
  }

  private async withYearlySeries(pattern: AnalysisPattern, input: AnalysisInput | undefined): Promise<AnalysisPattern> {
    if (!input?.region && !(input?.regions && input.regions.length > 0)) {
      return { ...pattern, yearlySeries: pattern.yearlySeries ?? [] };
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

  private async markFailed(userId: string, runId: string, reason: string): Promise<void> {
    try {
      await this.db.query(
        `UPDATE app.analysis_runs
            SET status = 'failed',
                completed_at = now(),
                failure_reason = $3
          WHERE id = $1::bigint
            AND user_id = $2::bigint`,
        [runId, userId, reason],
      );
    } catch {
      // The original compute error is more useful to the caller.
    }
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
  const status = asRunStatus(row.status);
  return {
    id: row.id,
    status,
    createdAt: toIso(row.created_at),
    startedAt: toOptionalIso(row.started_at),
    completedAt: toOptionalIso(row.completed_at),
    failureReason: status === "failed" ? emptyToNull(row.failure_reason) : null,
    input: row.input,
    brain: row.brain,
    pattern: row.pattern,
  };
}

function asRunStatus(value: string | null | undefined): AnalysisRunStatus {
  if (value === "queued" || value === "running" || value === "completed" || value === "failed") {
    return value;
  }
  return "completed";
}

function toOptionalIso(value: Date | string | null | undefined): string | null {
  if (value == null || value === "") return null;
  return toIso(value);
}

function failureReasonOf(error: unknown): string {
  if (error instanceof HttpException) {
    const body = error.getResponse();
    if (typeof body === "string" && body.trim()) return body.trim();
    if (body && typeof body === "object" && "message" in body) {
      const message = (body as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
  }
  return RUN_FAILED;
}

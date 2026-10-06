import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { DatabaseService, analysisTransaction, analysisWriteQuery } from "../database/database.service";
import { emptyToNull, toCoord, toIso, toRevenue } from "../customer/values";
import { fillMissingCatalogDisplay } from "../geo/catalog-display";
import { GeoCatalogService } from "../geo/geo-catalog.service";
import { isCatalogLevel } from "../geo/geo-catalog";
import { boundsFromRow, geometryFromUnknown } from "../geo/region-geometry";
import { Grain } from "../target-region/dto";
import { yieldEventLoop } from "../common/safe-array";
import { BrainSearchService } from "./brain-search.service";
import {
  readAnalysisMaxConcurrent,
  readAnalysisPhaseWarnMs,
  readAnalysisRunDeadlineMs,
} from "./analysis-env";
import {
  AnalysisFailurePhase,
  AnalysisRunFailureReason,
  analysisDeadlineError,
  asAnalysisRunFailureReason,
  failureDetailForLog,
  mapAnalysisFailureReason,
} from "./failure-reason";
import { interruptedError, throwIfAborted } from "./run-abort";
import {
  MARKED_TARGET_REGION_NOT_FOUND,
  MARKED_TARGET_REGION_NOT_FOUND_CODE,
  PATTERN_FOR_REGION_NOT_FOUND,
  PATTERN_NOT_FOUND,
  REGION_MISSING,
  REVENUE_INSUFFICIENT,
  RUN_NOT_FOUND,
  TOO_MANY_TARGET_REGIONS,
} from "./messages";
import { PatternService } from "./pattern.service";
import {
  filterYearlySeries,
  findSnapshotRegion,
  matchingGeoKeys,
  placeKeysMatch,
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
import { RecommendationsService, recommendationPayloadOf } from "../recommendations/recommendations.service";
import { MAX_TARGET_REGIONS } from "../recommendations/score";

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
export class AnalysisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalysisService.name);
  private readonly jobs = new Set<Promise<void>>();
  private readonly waiters: Array<() => void> = [];
  private readonly runControllers = new Map<string, AbortController>();
  private inflight = 0;
  private readonly maxConcurrent = readAnalysisMaxConcurrent();
  private readonly deadlineMs = readAnalysisRunDeadlineMs();
  private readonly phaseWarnMs = readAnalysisPhaseWarnMs();
  private closed = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly brain: BrainSearchService,
    private readonly patterns: PatternService,
    private readonly geoCatalog: GeoCatalogService,
    private readonly yearlySeries: YearlySeriesService,
    private readonly recommendations: RecommendationsService,
  ) {}

  /**
   * Rows left `queued`/`running` after a crash or deploy are not resumed.
   * Mark them `failed` with `interrupted` so clients stop polling.
   */
  async onModuleInit(): Promise<void> {
    try {
      const result = await this.db.query<{ id: string }>(
        `UPDATE app.analysis_runs
            SET status = 'failed',
                completed_at = COALESCE(completed_at, now()),
                failure_reason = 'interrupted'
          WHERE status IN ('queued', 'running')
          RETURNING id::text AS id`,
      );
      if (result.rows.length > 0) {
        this.logger.warn(
          `Marked ${result.rows.length} stale analysis run(s) interrupted: ${result.rows.map((row) => row.id).join(", ")}`,
        );
      }
    } catch (error) {
      this.logger.warn(`Could not mark stale analysis runs interrupted (${failureDetailForLog(error)}).`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.closed = true;
    for (const controller of this.runControllers.values()) {
      controller.abort(interruptedError());
    }
    await this.whenIdle();
  }

  /** Tests wait until background runs settle. */
  async whenIdle(): Promise<void> {
    while (this.jobs.size > 0) {
      await Promise.all([...this.jobs]);
    }
  }

  async getInput(userId: string): Promise<AnalysisInput> {
    return this.loadInput(userId);
  }

  /**
   * Snapshots region, stores, and revenue, inserts `queued`, and returns
   * 202 immediately. Brain/pattern/set work continues in the background.
   * GET never computes. Marking another Zielregion later does not start a run.
   */
  async createRun(userId: string, markedTargetRegionGeoKey?: string): Promise<AnalysisRun> {
    const input = await this.loadInput(userId, markedTargetRegionGeoKey);
    if (analysisRegions(input).length > MAX_TARGET_REGIONS) {
      throw new BadRequestException(TOO_MANY_TARGET_REGIONS);
    }
    const inserted = await this.db.query<{ id: string; created_at: Date | string }>(
      `INSERT INTO app.analysis_runs (user_id, status, input, brain, pattern)
       VALUES ($1::bigint, 'queued', $2::jsonb, $3::jsonb, $4::jsonb)
       RETURNING id::text AS id, created_at`,
      [userId, JSON.stringify(input), JSON.stringify(EMPTY_BRAIN), JSON.stringify(EMPTY_PATTERN)],
    );
    const row = inserted.rows[0];
    if (!row) throw new NotFoundException(RUN_NOT_FOUND);
    this.enqueue(userId, row.id);
    return {
      id: row.id,
      status: "queued",
      createdAt: toIso(row.created_at),
      startedAt: null,
      completedAt: null,
      failureReason: null,
      input,
      brain: EMPTY_BRAIN,
      pattern: EMPTY_PATTERN,
    };
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

  private enqueue(userId: string, runId: string): void {
    const job = this.runQueued(userId, runId);
    this.jobs.add(job);
    void job.finally(() => this.jobs.delete(job));
  }

  private async runQueued(userId: string, runId: string): Promise<void> {
    await this.acquireSlot();
    try {
      await this.executeRun(userId, runId);
    } finally {
      this.releaseSlot();
    }
  }

  private async acquireSlot(): Promise<void> {
    if (this.inflight < this.maxConcurrent) {
      this.inflight += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.inflight += 1;
  }

  private releaseSlot(): void {
    this.inflight = Math.max(0, this.inflight - 1);
    const next = this.waiters.shift();
    if (next) next();
  }

  private async executeRun(userId: string, runId: string): Promise<void> {
    if (this.closed) {
      await this.markFailed(userId, runId, "interrupted");
      return;
    }
    const controller = new AbortController();
    this.runControllers.set(runId, controller);
    const deadlineAt = Date.now() + this.deadlineMs;
    const remaining = Math.max(1, deadlineAt - Date.now());
    const timer = setTimeout(() => controller.abort(analysisDeadlineError()), remaining);
    const unbind = this.db.bindAnalysisAbort?.(controller.signal);
    let phase: AnalysisFailurePhase = "pattern";
    const started = Date.now();
    try {
      await this.markRunning(userId, runId);
      await yieldEventLoop();
      throwIfAborted(controller.signal);
      const row = await this.loadRunRow(userId, runId);
      if (!row) return;
      const input = row.input;

      const brain = await this.phase(
        "brain",
        runId,
        () => this.withDeadline(this.brain.search(input, controller.signal), deadlineAt, controller.signal),
        { candidateCount: analysisRegions(input).length },
      );
      const derived = await this.phase(
        "pattern",
        runId,
        () => this.withDeadline(this.patterns.derive(input, brain.facts), deadlineAt, controller.signal),
      );
      const pattern = await this.phase(
        "yearlySeries",
        runId,
        () => this.withDeadline(this.attachYearlySeries(derived, input, controller.signal), deadlineAt, controller.signal),
      );
      await analysisWriteQuery(this.db)(
        `UPDATE app.analysis_runs
            SET brain = $3::jsonb,
                pattern = $4::jsonb
          WHERE id = $1::bigint
            AND user_id = $2::bigint
            AND status = 'running'`,
        [runId, userId, JSON.stringify(brain), JSON.stringify(pattern)],
      );
      let setPayload = null as ReturnType<typeof recommendationPayloadOf> | null;
      if (analysisRegions(input).length > 0) {
        phase = "set";
        const created = await this.phase(
          "recommendations",
          runId,
          () =>
            this.withDeadline(
              this.recommendations.create(userId, runId, new Date(), {
                signal: controller.signal,
                persist: false,
                analysisPool: true,
              }),
              deadlineAt,
              controller.signal,
            ),
        );
        setPayload = recommendationPayloadOf(created);
      }
      throwIfAborted(controller.signal);
      await this.finishCompleted(userId, runId, brain, pattern, setPayload);
      this.logger.log(
        `Analysis run ${runId} completed in ${Date.now() - started}ms (deadlineMs=${this.deadlineMs})`,
      );
    } catch (error) {
      const reason = mapAnalysisFailureReason(error, phase);
      this.logger.error(`Analysis run ${runId} failed (${reason}): ${failureDetailForLog(error)}`);
      await this.db.cancelAnalysisWork?.().catch(() => undefined);
      await this.markFailed(userId, runId, reason);
    } finally {
      clearTimeout(timer);
      unbind?.();
      this.runControllers.delete(runId);
    }
  }

  private async phase<T>(
    name: string,
    runId: string,
    fn: () => Promise<T>,
    extra: { candidateCount?: number; cappedCount?: number; docs?: number; chunks?: number; maxSyncMs?: number } = {},
  ): Promise<T> {
    const started = Date.now();
    try {
      return await fn();
    } finally {
      const durationMs = Date.now() - started;
      const counts =
        extra.candidateCount != null ? ` candidateCount=${extra.candidateCount}` : "";
      const capped = extra.cappedCount != null ? ` cappedCount=${extra.cappedCount}` : "";
      const docs = extra.docs != null ? ` docs=${extra.docs}` : "";
      const chunks = extra.chunks != null ? ` chunks=${extra.chunks}` : "";
      const maxSync = extra.maxSyncMs != null ? ` maxSyncMs=${extra.maxSyncMs}` : "";
      const line = `Analysis run ${runId} phase=${name} durationMs=${durationMs}${counts}${capped}${docs}${chunks}${maxSync}`;
      if (durationMs >= this.phaseWarnMs) this.logger.warn(line);
      else this.logger.log(line);
      await yieldEventLoop();
    }
  }

  private async withDeadline<T>(work: Promise<T>, deadlineAt: number, signal?: AbortSignal): Promise<T> {
    throwIfAborted(signal);
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw analysisDeadlineError();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await Promise.race([
        work,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(analysisDeadlineError()), remaining);
          signal?.addEventListener(
            "abort",
            () => reject(analysisDeadlineError()),
            { once: true },
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  private async finishCompleted(
    userId: string,
    runId: string,
    brain: AnalysisBrain,
    pattern: AnalysisPattern,
    setPayload: ReturnType<typeof recommendationPayloadOf> | null,
  ): Promise<void> {
    throwIfAborted(this.runControllers.get(runId)?.signal);
    await analysisTransaction(this.db, async (query) => {
      if (setPayload) {
        const inserted = await query(
          `INSERT INTO app.recommendation_sets (user_id, analysis_run_id, payload)
           SELECT $1::bigint, $2::bigint, $3::jsonb
            WHERE EXISTS (
              SELECT 1
                FROM app.analysis_runs
               WHERE id = $2::bigint
                 AND user_id = $1::bigint
                 AND status = 'running'
            )
           RETURNING id::text AS id`,
          [userId, runId, JSON.stringify(setPayload)],
        );
        if (!inserted.rows[0]) {
          throw analysisDeadlineError();
        }
      }
      const updated = await query(
        `UPDATE app.analysis_runs
            SET status = 'completed',
                brain = $3::jsonb,
                pattern = $4::jsonb,
                completed_at = now(),
                failure_reason = NULL
          WHERE id = $1::bigint
            AND user_id = $2::bigint
            AND status = 'running'
          RETURNING started_at, completed_at`,
        [runId, userId, JSON.stringify(brain), JSON.stringify(pattern)],
      );
      if (!updated.rows[0]) {
        throw analysisDeadlineError();
      }
    });
  }

  private async markRunning(userId: string, runId: string): Promise<void> {
    await analysisWriteQuery(this.db)(
      `UPDATE app.analysis_runs
          SET status = 'running',
              started_at = COALESCE(started_at, now())
        WHERE id = $1::bigint
          AND user_id = $2::bigint
          AND status = 'queued'`,
      [runId, userId],
    );
  }

  private async loadRunRow(userId: string, runId: string): Promise<RunRow | undefined> {
    const result = await analysisWriteQuery(this.db)<RunRow>(
      `SELECT id::text AS id, status, input, brain, pattern, created_at,
              started_at, completed_at, failure_reason
       FROM app.analysis_runs
       WHERE id = $1::bigint
         AND user_id = $2::bigint`,
      [runId, userId],
    );
    return result.rows[0];
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

  private async attachYearlySeries(
    pattern: AnalysisPattern,
    input: AnalysisInput,
    signal?: AbortSignal,
  ): Promise<AnalysisPattern> {
    const yearlySeries = await this.yearlySeries.build(analysisRegions(input), asOfFrom(input.capturedAt), signal);
    return { ...pattern, yearlySeries };
  }

  private async withYearlySeries(pattern: AnalysisPattern, input: AnalysisInput | undefined): Promise<AnalysisPattern> {
    if (Array.isArray(pattern.yearlySeries) && pattern.yearlySeries.length > 0) {
      return { ...pattern, yearlySeries: pattern.yearlySeries };
    }
    if (!input?.region && !(input?.regions && input.regions.length > 0)) {
      return { ...pattern, yearlySeries: pattern.yearlySeries ?? [] };
    }
    this.logger.log("Stored yearlySeries missing; rebuilding as documented fallback.");
    return this.attachYearlySeries(pattern, input);
  }

  private async loadInput(userId: string, markedTargetRegionGeoKey?: string): Promise<AnalysisInput> {
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
    const marked = markedTargetRegionGeoKey?.trim();
    const region = marked
      ? regions.find((item) => placeKeysMatch(item.geoKey, marked))
      : regions[0];
    if (marked && !region) {
      throw new NotFoundException({
        statusCode: 404,
        message: MARKED_TARGET_REGION_NOT_FOUND,
        error: "Not Found",
        code: MARKED_TARGET_REGION_NOT_FOUND_CODE,
      });
    }
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

  private async markFailed(userId: string, runId: string, reason: AnalysisRunFailureReason): Promise<void> {
    try {
      await analysisWriteQuery(this.db)(
        `UPDATE app.analysis_runs
            SET status = 'failed',
                completed_at = now(),
                failure_reason = $3
          WHERE id = $1::bigint
            AND user_id = $2::bigint
            AND status IN ('queued', 'running')`,
        [runId, userId, reason],
      );
    } catch {
      // The original compute error is more useful in the log.
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
    failureReason: status === "failed" ? asAnalysisRunFailureReason(row.failure_reason) : null,
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

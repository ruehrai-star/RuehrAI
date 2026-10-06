import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { PATTERN_NOT_FOUND, RUN_NOT_FOUND, TOO_MANY_TARGET_REGIONS } from "../analysis/messages";
import { buildPatternByDataset, buildPatternByLevel } from "../analysis/pattern-profile";
import { StoreSurroundingsService } from "../analysis/store-surroundings.service";
import { AnalysisInput, AnalysisPattern, analysisRegions } from "../analysis/types";
import { SeriesRegionInput, YearlySeries, asOfFrom } from "../analysis/yearly-series";
import { YearlySeriesService } from "../analysis/yearly-series.service";
import { DatabaseService, analysisWriteQuery } from "../database/database.service";
import { toIso } from "../customer/values";
import { AreaCandidate, targetRegionKeyOf, targetRegionsFromAnalysis } from "./area-candidates";
import { AreaCandidateService } from "./area-candidate.service";
import { capCandidatesForSeries } from "./candidate-cap";
import { RECOMMENDATIONS_NOT_FOUND, RECOMMENDATIONS_NOT_STORED, recommendationReason } from "./messages";
import { RationaleService } from "./rationale.service";
import { displayAreaName, visibleAreaName } from "./hit-display";
import { attachHitOverlaps } from "./hit-overlaps";
import { RecommendationItem, RecommendationPayload, RecommendationSet } from "./types";
import { threeYearWindow } from "./window";
import { yieldEventLoop } from "../common/safe-array";
import { runComputeJob } from "../analysis/compute-host";
import { readAnalysisSeriesCandidateCap } from "../analysis/analysis-env";
import { throwIfAborted } from "../analysis/run-abort";
import { assignRanksByTargetRegion, dataAsOfFromEvidence, MAX_TARGET_REGIONS } from "./score";

interface RunRow {
  id: string;
  input: AnalysisInput;
  pattern: AnalysisPattern;
}

interface SetRow {
  id: string;
  payload: RecommendationPayload;
  created_at: Date | string;
}

export interface RecommendationCreateOptions {
  signal?: AbortSignal;
  /** When false the payload is returned but not inserted (caller commits with run completion). */
  persist?: boolean;
  /** Worker path: analysis pool. HTTP POST uses the main pool. */
  analysisPool?: boolean;
}

@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly areas: AreaCandidateService,
    private readonly surroundings: StoreSurroundingsService,
    private readonly yearlySeries: YearlySeriesService,
    private readonly rationales: RationaleService,
  ) {}

  /**
   * Rank Teilflächen inside the Zielregion against the store-surroundings
   * pattern. Empty only when no sub-area exists.
   */
  async create(
    userId: string,
    runId?: string,
    asOf: Date = new Date(),
    options: RecommendationCreateOptions = {},
  ): Promise<RecommendationSet> {
    const signal = options.signal;
    throwIfAborted(signal);
    const persist = options.persist !== false;
    const query = options.analysisPool ? analysisWriteQuery(this.db) : this.db.query.bind(this.db);
    const run = await this.loadRun(userId, runId, query);
    const captured = asOfFrom(run.input.capturedAt);
    const asOfDate = asOf && !Number.isNaN(asOf.getTime()) ? asOf : captured;
    const regions = analysisRegions(run.input);
    if (regions.length > MAX_TARGET_REGIONS) {
      throw new BadRequestException(TOO_MANY_TARGET_REGIONS);
    }

    const surroundings = await this.surroundings.resolve(run.input.stores);
    throwIfAborted(signal);
    const storeSeries = await this.yearlySeries.build(surroundings.regions, asOfDate, signal);
    throwIfAborted(signal);
    const patternByLevel = buildPatternByLevel(surroundings.regions, storeSeries);
    const patternByDataset = buildPatternByDataset(storeSeries);
    const derived = patternByDataset.map((item) => item.criterion);
    const pattern: AnalysisPattern = {
      ...run.pattern,
      revenueDirection: run.input.revenueDirection,
      criteria: derived.length > 0 ? derived : run.pattern.criteria ?? [],
    };

    const loaded = await this.areas.load(regions, signal);
    const cap = readAnalysisSeriesCandidateCap();
    // Stage 1: cheap baseline score on every candidate, no Dreijahresreihen.
    throwIfAborted(signal);
    await yieldEventLoop();
    const capped = capCandidatesForSeries(loaded.items, regions, cap);
    this.logger.log(
      `Recommendation set for run ${run.id}: candidateCount=${capped.candidateCount} cappedCount=${capped.cappedCount} cap=${cap} truncated=${loaded.truncated || capped.truncated}`,
    );
    throwIfAborted(signal);
    await yieldEventLoop();
    // Stage 2: YearlySeries only for the Top-N per Zielregion (fair share, env cap).
    const seriesTargets = capped.selected.map(toSeriesRegion);
    const candidateSeries =
      seriesTargets.length === 0 ? [] : await this.yearlySeries.build(seriesTargets, asOfDate, signal);
    throwIfAborted(signal);
    await yieldEventLoop();
    const slim = capped.selected.map(stripGeometry);
    const rankedJob = await runComputeJob(
      {
        type: "rank",
        candidates: slim,
        series: candidateSeries,
        criteria: pattern.criteria,
        regions,
      },
      signal,
    );
    if (rankedJob.type !== "rank") throw new Error(`rank worker returned ${rankedJob.type}`);
    const ranked = reattachGeometry(rankedJob.ranked, capped.selected);
    throwIfAborted(signal);
    await yieldEventLoop();
    const withOverlaps = await attachHitOverlaps(this.db, ranked, regions);
    throwIfAborted(signal);
    await yieldEventLoop();
    const window = threeYearWindow(asOfDate, yearsFrom(storeSeries, candidateSeries));
    const written = await this.rationales.write(pattern, window, withOverlaps, signal);
    throwIfAborted(signal);
    const regionOrder = regions.map((region) => targetRegionKeyOf(region)).filter((key) => key.length > 0);
    const rankedItems = assignRanksByTargetRegion(written, regionOrder);
    const payload: RecommendationPayload = {
      runId: run.id,
      window,
      count: rankedItems.length,
      reason: recommendationReason({
        candidateCount: capped.candidateCount,
        truncated: loaded.truncated || capped.truncated,
      }),
      pattern,
      patternByLevel,
      patternByDataset,
      targetRegions: targetRegionsFromAnalysis(regions),
      items: rankedItems,
    };
    if (!persist) {
      return toSet("0", new Date().toISOString(), payload);
    }
    const inserted = await query<{ id: string; created_at: Date | string }>(
      `INSERT INTO app.recommendation_sets (user_id, analysis_run_id, payload)
       VALUES ($1::bigint, $2::bigint, $3::jsonb)
       RETURNING id::text AS id, created_at`,
      [userId, run.id, JSON.stringify(payload)],
    );
    const row = inserted.rows[0];
    if (!row) throw new InternalServerErrorException(RECOMMENDATIONS_NOT_STORED);
    return toSet(row.id, row.created_at, payload);
  }

  async latest(userId: string, runId?: string): Promise<RecommendationSet> {
    if (runId) {
      const result = await this.db.query<SetRow>(
        `SELECT s.id::text AS id, s.payload, s.created_at
         FROM app.recommendation_sets s
         LEFT JOIN app.analysis_runs r ON r.id = s.analysis_run_id
         WHERE s.user_id = $1::bigint
           AND s.analysis_run_id = $2::bigint
           AND (s.analysis_run_id IS NULL OR r.status = 'completed')
         ORDER BY s.created_at DESC, s.id DESC
         LIMIT 1`,
        [userId, runId],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundException(RECOMMENDATIONS_NOT_FOUND);
      return toSet(row.id, row.created_at, row.payload);
    }
    const result = await this.db.query<SetRow>(
      `SELECT s.id::text AS id, s.payload, s.created_at
       FROM app.recommendation_sets s
       LEFT JOIN app.analysis_runs r ON r.id = s.analysis_run_id
       WHERE s.user_id = $1::bigint
         AND (s.analysis_run_id IS NULL OR r.status = 'completed')
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT 1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException(RECOMMENDATIONS_NOT_FOUND);
    return toSet(row.id, row.created_at, row.payload);
  }

  private async loadRun(
    userId: string,
    runId: string | undefined,
    query: DatabaseService["query"],
  ): Promise<RunRow> {
    if (runId) {
      const result = await query<RunRow>(
        `SELECT id::text AS id, input, pattern
         FROM app.analysis_runs
         WHERE id = $1::bigint
           AND user_id = $2::bigint
           AND status IN ('running', 'completed')`,
        [runId, userId],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundException(RUN_NOT_FOUND);
      return row;
    }
    const result = await query<RunRow>(
      `SELECT id::text AS id, input, pattern
       FROM app.analysis_runs
       WHERE user_id = $1::bigint
         AND status = 'completed'
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException(PATTERN_NOT_FOUND);
    return row;
  }
}

function toSeriesRegion(candidate: AreaCandidate): SeriesRegionInput {
  return {
    grain: candidate.grain,
    geoKey: candidate.geoKey,
    level: candidate.kind === "plz" ? "plz" : candidate.kind,
    ags: candidate.ags,
    plz: candidate.plz,
  };
}

function yearsFrom(...lists: YearlySeries[][]): number[] {
  const years: number[] = [];
  for (const list of lists) {
    for (const series of list) {
      for (const point of series.points) {
        const year = Number(point.period.slice(0, 4));
        if (Number.isFinite(year)) years.push(year);
      }
    }
  }
  return years;
}

function toSet(id: string, createdAt: Date | string, payload: RecommendationPayload): RecommendationSet {
  return {
    id,
    createdAt: toIso(createdAt),
    ...payload,
    items: payload.items.map(hydrateHitDisplay),
  };
}

function hydrateHitDisplay(item: RecommendationItem): RecommendationItem {
  if (!item.location) return item;
  const name = displayAreaName({
    kind: item.kind,
    grain: item.grain ?? item.location.grain,
    geoKey: item.location.geoKey,
    name: item.name !== undefined ? item.name : item.location.name,
    title: item.title,
    plz: null,
  });
  const grain = item.grain ?? item.location.grain;
  const parentLabel = item.parentLabel !== undefined ? item.parentLabel : null;
  const targetRegionGeoKey = item.targetRegionGeoKey?.trim() ?? "";
  const dataAsOf =
    item.dataAsOf !== undefined ? item.dataAsOf : dataAsOfFromEvidence(item.criteriaEvidence ?? []);
  return {
    ...item,
    grain,
    name,
    parentLabel: parentLabel ?? null,
    targetRegionGeoKey,
    dataAsOf,
    title: visibleAreaName(item.title) ?? name,
    location: {
      ...item.location,
      grain,
      name,
    },
  };
}

function stripGeometry(candidate: AreaCandidate): AreaCandidate {
  if (!candidate.geometry) return candidate;
  return { ...candidate, geometry: null };
}

function reattachGeometry<T extends { id: string; geometry?: AreaCandidate["geometry"] }>(
  ranked: T[],
  originals: AreaCandidate[],
): T[] {
  const byId = new Map(originals.map((item) => [item.id, item]));
  return ranked.map((item) => {
    const original = byId.get(item.id);
    if (!original?.geometry) return item;
    return { ...item, geometry: original.geometry };
  });
}

export function recommendationPayloadOf(set: RecommendationSet): RecommendationPayload {
  return {
    runId: set.runId,
    window: set.window,
    count: set.count,
    reason: set.reason,
    pattern: set.pattern,
    patternByLevel: set.patternByLevel,
    patternByDataset: set.patternByDataset,
    targetRegions: set.targetRegions,
    items: set.items,
  };
}

import { Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { PATTERN_NOT_FOUND, RUN_NOT_FOUND } from "../analysis/messages";
import { buildPatternByDataset, buildPatternByLevel } from "../analysis/pattern-profile";
import { StoreSurroundingsService } from "../analysis/store-surroundings.service";
import { AnalysisInput, AnalysisPattern, analysisRegions } from "../analysis/types";
import { SeriesRegionInput, YearlySeries, asOfFrom } from "../analysis/yearly-series";
import { YearlySeriesService } from "../analysis/yearly-series.service";
import { DatabaseService } from "../database/database.service";
import { toIso } from "../customer/values";
import { AreaCandidate } from "./area-candidates";
import { AreaCandidateService } from "./area-candidate.service";
import { RECOMMENDATIONS_NOT_FOUND, RECOMMENDATIONS_NOT_STORED, recommendationReason } from "./messages";
import { RationaleService } from "./rationale.service";
import { rankTeilflaechen } from "./score";
import { visibleAreaName } from "./hit-display";
import { RecommendationItem, RecommendationPayload, RecommendationSet } from "./types";
import { threeYearWindow } from "./window";
import { yieldEventLoop } from "../common/safe-array";

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
  async create(userId: string, runId?: string, asOf: Date = new Date()): Promise<RecommendationSet> {
    const run = await this.loadRun(userId, runId);
    const captured = asOfFrom(run.input.capturedAt);
    const asOfDate = Number.isNaN(asOf.getTime()) ? captured : asOf;

    const surroundings = await this.surroundings.resolve(run.input.stores);
    const storeSeries = await this.yearlySeries.build(surroundings.regions, asOfDate);
    const patternByLevel = buildPatternByLevel(surroundings.regions, storeSeries);
    const patternByDataset = buildPatternByDataset(storeSeries);
    const derived = patternByDataset.map((item) => item.criterion);
    const pattern: AnalysisPattern = {
      ...run.pattern,
      revenueDirection: run.input.revenueDirection,
      criteria: derived.length > 0 ? derived : run.pattern.criteria ?? [],
    };

    const loaded = await this.areas.load(analysisRegions(run.input));
    this.logger.log(
      `Recommendation set for run ${run.id}: candidateCount=${loaded.items.length} truncated=${loaded.truncated}`,
    );
    await yieldEventLoop();
    const candidateSeries =
      loaded.items.length === 0 ? [] : await this.yearlySeries.build(loaded.items.map(toSeriesRegion), asOfDate);
    await yieldEventLoop();
    const ranked = rankTeilflaechen(loaded.items, candidateSeries, pattern.criteria, analysisRegions(run.input));
    await yieldEventLoop();
    const window = threeYearWindow(asOfDate, yearsFrom(storeSeries, candidateSeries));
    const written = await this.rationales.write(pattern, window, ranked);
    const payload: RecommendationPayload = {
      runId: run.id,
      window,
      count: written.length,
      reason: recommendationReason({
        candidateCount: loaded.items.length,
        truncated: loaded.truncated,
      }),
      pattern,
      patternByLevel,
      patternByDataset,
      items: written.map((item, index) => ({ ...item, rank: index + 1 })),
    };
    const inserted = await this.db.query<{ id: string; created_at: Date | string }>(
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
        `SELECT id::text AS id, payload, created_at
         FROM app.recommendation_sets
         WHERE user_id = $1::bigint
           AND analysis_run_id = $2::bigint
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [userId, runId],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundException(RECOMMENDATIONS_NOT_FOUND);
      return toSet(row.id, row.created_at, row.payload);
    }
    const result = await this.db.query<SetRow>(
      `SELECT id::text AS id, payload, created_at
       FROM app.recommendation_sets
       WHERE user_id = $1::bigint
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException(RECOMMENDATIONS_NOT_FOUND);
    return toSet(row.id, row.created_at, row.payload);
  }

  private async loadRun(userId: string, runId?: string): Promise<RunRow> {
    if (runId) {
      const result = await this.db.query<RunRow>(
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
    const result = await this.db.query<RunRow>(
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
  const name = item.name !== undefined ? item.name : visibleAreaName(item.location.name);
  const grain = item.grain ?? item.location.grain;
  const parentLabel = item.parentLabel !== undefined ? item.parentLabel : null;
  return {
    ...item,
    grain,
    name: name ?? null,
    parentLabel: parentLabel ?? null,
    location: {
      ...item.location,
      grain,
      name: name ?? item.location.name,
    },
  };
}

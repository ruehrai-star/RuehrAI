import { Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { PATTERN_NOT_FOUND, RUN_NOT_FOUND } from "../analysis/messages";
import { AnalysisInput, AnalysisPattern, PatternCriterion, analysisRegions } from "../analysis/types";
import { DatabaseService } from "../database/database.service";
import { toIso } from "../customer/values";
import { CandidateSearchService } from "./candidate-search.service";
import { RECOMMENDATIONS_NOT_FOUND, RECOMMENDATIONS_NOT_STORED, recommendationReason } from "./messages";
import { rankCandidates, withoutRegionAnchors } from "./rank";
import { RationaleService } from "./rationale.service";
import { RecommendationPayload, RecommendationSet } from "./types";
import { lastSixMonths } from "./window";

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
  constructor(
    private readonly db: DatabaseService,
    private readonly candidates: CandidateSearchService,
    private readonly rationales: RationaleService,
  ) {}

  /**
   * Rank up to three locations for the caller's completed pattern and store
   * the set. Fewer than three is a normal result with `reason` set.
   */
  async create(userId: string, runId?: string, asOf: Date = new Date()): Promise<RecommendationSet> {
    const run = await this.loadRun(userId, runId);
    const months = lastSixMonths(asOf);
    const criteria = criteriaOf(run.pattern);
    const hasDirection = criteria.some((criterion) => criterion.direction !== "unknown");
    const regions = analysisRegions(run.input);
    const loaded = hasDirection
      ? await this.candidates.loadMany(regions, months)
      : { rows: [], truncated: false };
    const ranked = withoutRegionAnchors(
      rankCandidates(loaded.rows, criteria, new Set(months)),
      regions,
    );
    const top = ranked.slice(0, 3);
    const window = { from: months[0] ?? "", to: months[months.length - 1] ?? "" };
    const written = await this.rationales.write(run.pattern, window, top);
    const payload: RecommendationPayload = {
      runId: run.id,
      window,
      count: written.length,
      reason: recommendationReason({
        hasDirection,
        factCount: loaded.rows.length,
        positiveCount: ranked.length,
        truncated: loaded.truncated,
      }),
      pattern: run.pattern,
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

  async latest(userId: string): Promise<RecommendationSet> {
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
           AND status = 'completed'`,
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

function criteriaOf(pattern: AnalysisPattern): PatternCriterion[] {
  return Array.isArray(pattern?.criteria) ? pattern.criteria : [];
}

function toSet(
  id: string,
  createdAt: Date | string,
  payload: RecommendationPayload,
): RecommendationSet {
  return {
    id,
    createdAt: toIso(createdAt),
    ...payload,
  };
}

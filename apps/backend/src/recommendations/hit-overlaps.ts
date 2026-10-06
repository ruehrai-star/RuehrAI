import { Logger } from "@nestjs/common";
import { DatabaseService, featuresReadQuery } from "../database/database.service";
import { AreaKind, isAreaKind } from "./area-candidates";
import {
  OVERLAP_MIN_SHARE,
  assertCandidateQueryArity,
  hitOverlapQuery,
  overlapEligibleKind,
} from "./area-candidates";
import { RecommendationOverlap } from "./types";

export interface HitOverlapRow {
  hit_geo_key: string | null;
  geo_key: string | null;
  label: string | null;
  kind: string | null;
  share: number | string | null;
}

export interface OverlapHost {
  kind: AreaKind;
  location: { geoKey: string };
  overlaps?: RecommendationOverlap[];
}

const logger = new Logger("HitOverlaps");

/** Keep shares ≥ 1 %, sort descending. Empty list → omit. */
export function selectOverlaps(rows: HitOverlapRow[]): RecommendationOverlap[] {
  const parts: RecommendationOverlap[] = [];
  for (const row of rows) {
    const overlap = toOverlap(row);
    if (overlap) parts.push(overlap);
  }
  parts.sort((left, right) => {
    if (right.share !== left.share) return right.share - left.share;
    return left.label.localeCompare(right.label, "de");
  });
  return parts;
}

export function groupOverlapsByHit(rows: HitOverlapRow[]): Map<string, RecommendationOverlap[]> {
  const grouped = new Map<string, HitOverlapRow[]>();
  for (const row of rows) {
    const key = row.hit_geo_key?.trim();
    if (!key) continue;
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }
  const out = new Map<string, RecommendationOverlap[]>();
  for (const [key, list] of grouped) {
    const parts = selectOverlaps(list);
    if (parts.length > 0) out.set(key, parts);
  }
  return out;
}

export async function attachHitOverlaps<T extends OverlapHost>(
  db: Pick<DatabaseService, "queryReadingFeatures"> & {
    queryAnalysisFeatures?: DatabaseService["queryAnalysisFeatures"];
  },
  hits: T[],
): Promise<T[]> {
  const eligible = hits.filter((hit) => overlapEligibleKind(hit.kind));
  if (eligible.length === 0) return hits;
  const query = hitOverlapQuery(eligible.map((hit) => ({ geoKey: hit.location.geoKey, kind: hit.kind })));
  if ((query.params[0] as string[]).length === 0) return hits;
  try {
    assertCandidateQueryArity(query);
    const result = await featuresReadQuery(db)<HitOverlapRow>(query.sql, query.params);
    const byHit = groupOverlapsByHit(result.rows);
    return hits.map((hit) => {
      const overlaps = byHit.get(hit.location.geoKey);
      if (!overlaps || overlaps.length === 0) return hit;
      return { ...hit, overlaps };
    });
  } catch (error) {
    logger.warn(`Hit overlaps query missed (${messageOf(error)}); omitting overlaps.`);
    return hits;
  }
}

function toOverlap(row: HitOverlapRow): RecommendationOverlap | null {
  const geoKey = row.geo_key?.trim() ?? "";
  const label = row.label?.trim() ?? "";
  const kind = row.kind?.trim() ?? "";
  const share = typeof row.share === "number" ? row.share : Number(row.share);
  if (!geoKey || !label || !isAreaKind(kind) || !Number.isFinite(share)) return null;
  if (share < OVERLAP_MIN_SHARE) return null;
  return {
    geoKey,
    label,
    kind,
    share: roundShare(share),
  };
}

function roundShare(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

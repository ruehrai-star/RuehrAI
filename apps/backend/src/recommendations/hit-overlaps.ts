import { Logger } from "@nestjs/common";
import { AnalysisRegion } from "../analysis/types";
import { DatabaseService, featuresReadQuery } from "../database/database.service";
import { isGeoRefQuartierUnavailable } from "../database/pg-error";
import { AreaKind, isAreaKind } from "./area-candidates";
import {
  OVERLAP_MIN_SHARE,
  assertCandidateQueryArity,
  hitOverlapQuery,
  overlapEligibleKind,
  overlapRegionMeta,
  regionsGeometryParam,
} from "./area-candidates";
import { RecommendationOverlap } from "./types";

export interface HitOverlapRow {
  hit_geo_key: string | null;
  geo_key: string | null;
  label: string | null;
  kind: string | null;
  share: number | string | null;
  is_target_region?: boolean | string | number | null;
}

export interface OverlapHost {
  id: string;
  kind: AreaKind;
  location: { geoKey: string };
  targetRegionGeoKey?: string;
  overlaps?: RecommendationOverlap[];
}

const logger = new Logger("HitOverlaps");

/** Zielregion first (`isTargetRegion`), then share descending. Empty list → omit. */
export function selectOverlaps(rows: HitOverlapRow[]): RecommendationOverlap[] {
  const parts: RecommendationOverlap[] = [];
  for (const row of rows) {
    const overlap = toOverlap(row);
    if (overlap) parts.push(overlap);
  }
  parts.sort((left, right) => {
    const leftTarget = left.isTargetRegion === true;
    const rightTarget = right.isTargetRegion === true;
    if (leftTarget !== rightTarget) return leftTarget ? -1 : 1;
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
  regions: AnalysisRegion[] = [],
): Promise<T[]> {
  const eligible = hits.filter((hit) => overlapEligibleKind(hit.kind));
  if (eligible.length === 0) return hits;

  const byRegion = new Map<string, T[]>();
  for (const hit of eligible) {
    const key = hit.targetRegionGeoKey?.trim() ?? "";
    const list = byRegion.get(key) ?? [];
    list.push(hit);
    byRegion.set(key, list);
  }

  const overlapsById = new Map<string, RecommendationOverlap[]>();
  try {
    for (const [regionKey, regionHits] of byRegion) {
      const region = regionKey ? regions.find((item) => (item.geoKey?.trim() ?? "") === regionKey) : undefined;
      const geometry = region ? regionsGeometryParam([region]) : regionsGeometryParam(regions);
      const query = hitOverlapQuery(
        regionHits.map((hit) => ({ geoKey: hit.location.geoKey, kind: hit.kind })),
        geometry,
        overlapRegionMeta(region),
      );
      if ((query.params[0] as string[]).length === 0) continue;
      assertCandidateQueryArity(query);
      let result: { rows: HitOverlapRow[] };
      try {
        result = await featuresReadQuery(db)<HitOverlapRow>(query.sql, query.params);
      } catch (error) {
        if (!isGeoRefQuartierUnavailable(error)) throw error;
        const fallback = hitOverlapQuery(
          regionHits.map((hit) => ({ geoKey: hit.location.geoKey, kind: hit.kind })),
          geometry,
          overlapRegionMeta(region),
          { includeQuartierGeom: false },
        );
        assertCandidateQueryArity(fallback);
        result = await featuresReadQuery(db)<HitOverlapRow>(fallback.sql, fallback.params);
      }
      const byHit = groupOverlapsByHit(result.rows);
      for (const hit of regionHits) {
        const overlaps = byHit.get(hit.location.geoKey);
        if (overlaps && overlaps.length > 0) overlapsById.set(hit.id, overlaps);
      }
    }
  } catch (error) {
    logger.warn(`Hit overlaps query missed (${messageOf(error)}); omitting overlaps.`);
    return hits;
  }

  return hits.map((hit) => {
    const overlaps = overlapsById.get(hit.id);
    if (!overlaps || overlaps.length === 0) return hit;
    return { ...hit, overlaps };
  });
}

function toOverlap(row: HitOverlapRow): RecommendationOverlap | null {
  const geoKey = row.geo_key?.trim() ?? "";
  const label = row.label?.trim() ?? "";
  const kind = row.kind?.trim() ?? "";
  const share = typeof row.share === "number" ? row.share : Number(row.share);
  const isTarget = isTargetRegionFlag(row.is_target_region);
  if (!geoKey || !label || !isAreaKind(kind) || !Number.isFinite(share)) return null;
  if (looksLikeCatalogKey(label)) return null;
  if (share < 0 || share > 1) return null;
  if (!isTarget && share < OVERLAP_MIN_SHARE) return null;
  return {
    geoKey,
    label,
    kind,
    share: roundShare(share),
    ...(isTarget ? { isTargetRegion: true } : {}),
  };
}

function isTargetRegionFlag(value: HitOverlapRow["is_target_region"]): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}

/** Labels must be display names, never catalog keys. */
export function looksLikeCatalogKey(label: string): boolean {
  return /^(?:ags|ags5|plz5|plz8|bezirk|stadtbezirk|stadtteil|ortsteil|grid100|address|lor:plr|koeln:sq|quartier|lor|hamburg_stadtteil):/i.test(
    label.trim(),
  );
}

function roundShare(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

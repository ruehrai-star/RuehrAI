import { AnalysisRegion } from "../analysis/types";
import { AreaCandidate, AreaKind, areaKindRank } from "./area-candidates";

export const DEFAULT_SERIES_CANDIDATE_CAP = 400;

/**
 * Cheap structural score used before YearlySeries. Finer grain and smaller
 * Fläche rank higher. No Brain docs, no Dreijahresreihen.
 */
export function cheapBaselineScore(candidate: AreaCandidate): number {
  const kindScore = 10 - areaKindRank(candidate.kind);
  const area = approximateArea(candidate);
  return kindScore * 1_000_000 + 1_000 / (1 + area);
}

/**
 * Cap the candidate pool **for the whole run**, then share slots fairly across
 * Zielregionen so each keeps hits. Within a region, round-robin across Ebenen
 * (finest first) so every present level stays represented.
 */
export function capCandidatesForSeries(
  candidates: AreaCandidate[],
  regions: AnalysisRegion[],
  cap: number,
): {
  selected: AreaCandidate[];
  candidateCount: number;
  cappedCount: number;
  truncated: boolean;
} {
  const candidateCount = candidates.length;
  const limit = Number.isInteger(cap) && cap > 0 ? cap : DEFAULT_SERIES_CANDIDATE_CAP;
  if (candidateCount <= limit) {
    return {
      selected: candidates,
      candidateCount,
      cappedCount: candidateCount,
      truncated: false,
    };
  }

  const groups = groupByTargetRegion(candidates, regions);
  const quotas = fairQuotas(groups, limit);
  const selected: AreaCandidate[] = [];
  const leftover: AreaCandidate[] = [];
  for (const [key, items] of groups) {
    const quota = quotas.get(key) ?? 0;
    const picked = pickRepresentingLevels(items, quota);
    selected.push(...picked.picked);
    leftover.push(...picked.rest);
  }
  leftover.sort(compareCheap);
  const missing = limit - selected.length;
  if (missing > 0) selected.push(...leftover.slice(0, missing));

  return {
    selected: selected.slice(0, limit),
    candidateCount,
    cappedCount: Math.min(selected.length, limit),
    truncated: true,
  };
}

function groupByTargetRegion(
  candidates: AreaCandidate[],
  _regions: AnalysisRegion[],
): Map<string, AreaCandidate[]> {
  const grouped = new Map<string, AreaCandidate[]>();
  for (const candidate of candidates) {
    const key = assignTargetRegion(candidate);
    const list = grouped.get(key) ?? [];
    list.push(candidate);
    grouped.set(key, list);
  }
  return grouped;
}

/**
 * Cap groups exclusively by `targetRegionGeoKey` from the per-Zielregion
 * catalog load (`geo_ref_zielregion_teil` / clipped query). Never `ags`/`plz`.
 */
export function assignTargetRegion(
  candidate: Pick<AreaCandidate, "targetRegionGeoKey">,
  _regions?: AnalysisRegion[],
): string {
  return candidate.targetRegionGeoKey?.trim() || "_unassigned";
}

function fairQuotas(groups: Map<string, AreaCandidate[]>, cap: number): Map<string, number> {
  const keys = [...groups.keys()];
  const quotas = new Map<string, number>();
  if (keys.length === 0) return quotas;
  const base = Math.floor(cap / keys.length);
  for (const key of keys) {
    quotas.set(key, Math.min(groups.get(key)!.length, base));
  }
  let leftover = cap - [...quotas.values()].reduce((sum, value) => sum + value, 0);
  const hungry = keys.filter((key) => (quotas.get(key) ?? 0) < groups.get(key)!.length);
  let index = 0;
  while (leftover > 0 && hungry.length > 0 && index < cap * 4) {
    const key = hungry[index % hungry.length]!;
    const current = quotas.get(key) ?? 0;
    const size = groups.get(key)!.length;
    if (current < size) {
      quotas.set(key, current + 1);
      leftover -= 1;
      if (current + 1 >= size) {
        hungry.splice(hungry.indexOf(key), 1);
        continue;
      }
    }
    index += 1;
  }
  return quotas;
}

function pickRepresentingLevels(
  items: AreaCandidate[],
  quota: number,
): { picked: AreaCandidate[]; rest: AreaCandidate[] } {
  if (quota <= 0) return { picked: [], rest: [...items].sort(compareCheap) };
  const byKind = new Map<AreaKind, AreaCandidate[]>();
  for (const item of items) {
    const list = byKind.get(item.kind) ?? [];
    list.push(item);
    byKind.set(item.kind, list);
  }
  for (const list of byKind.values()) list.sort(compareCheap);
  const kinds = [...byKind.keys()].sort((left, right) => areaKindRank(left) - areaKindRank(right));
  const picked: AreaCandidate[] = [];
  const used = new Set<string>();
  let added = true;
  while (picked.length < quota && added) {
    added = false;
    for (const kind of kinds) {
      if (picked.length >= quota) break;
      const next = byKind.get(kind)?.find((item) => !used.has(item.id));
      if (!next) continue;
      used.add(next.id);
      picked.push(next);
      added = true;
    }
  }
  const rest = items.filter((item) => !used.has(item.id)).sort(compareCheap);
  return { picked, rest };
}

function compareCheap(left: AreaCandidate, right: AreaCandidate): number {
  const delta = cheapBaselineScore(right) - cheapBaselineScore(left);
  if (delta !== 0) return delta;
  const byTitle = left.title.localeCompare(right.title, "de");
  if (byTitle !== 0) return byTitle;
  return left.id.localeCompare(right.id, "de");
}

function approximateArea(candidate: AreaCandidate): number {
  const geometry = candidate.geometry;
  if (!geometry) return Number.POSITIVE_INFINITY;
  const rings = geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const ring of rings) {
    for (const position of ring) {
      const lon = position[0];
      const lat = position[1];
      if (lon == null || lat == null) continue;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (maxLon - minLon) * (maxLat - minLat));
}

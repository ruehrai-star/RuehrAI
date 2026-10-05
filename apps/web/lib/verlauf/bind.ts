import type { AnalysisPattern, AnalysisRun, YearlySeries } from "@ruehrai/api-contracts";
import { ApiError, isGrain, type AnalysisPatternRegion, type AnalysisPatternResponse } from "../api/types.ts";
import type { RuehrApi } from "../api/client.ts";
import { catalogBadge, catalogLevelOf, catalogParentName, catalogPlaceName } from "../format.ts";
import { catalogKeyVariants, placeKeySet, samePlace, type PlaceRef } from "../locations/regions.ts";

/**
 * Bind Verlauf to the marked Zielregion.
 *
 * Tracks the Backend Draft-PR for `GET /analysis/pattern?geoKey=`. Until
 * OpenAPI on main lists that query, the Web client sends it and still
 * verifies `region` / `input.region` / `input.regions` so another region's
 * latest run never fills the page.
 */

export interface BoundVerlauf {
  runId: string;
  createdAt: string;
  region: AnalysisPatternRegion;
  pattern: AnalysisPattern;
}

export function patternQueryGeoKey(region: PlaceRef | null | undefined): string | null {
  if (!region || typeof region.geoKey !== "string") return null;
  const trimmed = region.geoKey.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Visible region name for the Stand line.
 * With parentLabel: name and parent. Without: name and level.
 */
export function standRegionLabel(
  region: (PlaceRef & { level?: unknown; grain?: unknown; ags?: unknown }) | null | undefined,
): string {
  if (!region) return "";
  const name = catalogPlaceName(region) ?? trimLabel(region.label);
  const parent = catalogParentName(region);
  if (parent) return [name, parent].filter((part) => part.length > 0).join(", ");
  const level = catalogBadge({
    level: region.level,
    grain: isGrain(region.grain) ? region.grain : undefined,
    geoKey: region.geoKey,
    ags: typeof region.ags === "string" ? region.ags : undefined,
  });
  return [name, level].filter((part) => part.length > 0).join(", ");
}

export function formatStandDate(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** `Stand: Lauf vom [Datum, Uhrzeit] für [Name der Region].` */
export function formatStandLine(
  createdAt: string,
  region: (PlaceRef & { level?: unknown; grain?: unknown; ags?: unknown }) | null | undefined,
): string {
  return `Stand: Lauf vom ${formatStandDate(createdAt)} für ${standRegionLabel(region)}`;
}

export function patternMatchesMarkedRegion(
  patternRegion: PlaceRef | null | undefined,
  marked: PlaceRef,
): boolean {
  if (!patternRegion) return false;
  return samePlace(patternRegion, marked);
}

export function runMatchesMarkedRegion(run: Pick<AnalysisRun, "input">, marked: PlaceRef): boolean {
  const candidates = [run.input.region, ...(run.input.regions ?? [])];
  return candidates.some((item) => item != null && samePlace(item, marked));
}

export function yearlySeriesForRegion(
  series: YearlySeries[] | undefined,
  marked: PlaceRef,
): YearlySeries[] | undefined {
  if (!series) return undefined;
  const keys = placeKeySet(marked);
  return series.filter((item) => catalogKeyVariants(item.requestedGeoKey).some((key) => keys.has(key)));
}

export function bindPatternToMarkedRegion(input: {
  latest: AnalysisPatternResponse | null;
  run?: Pick<AnalysisRun, "input"> | null;
  marked: PlaceRef & { level?: unknown; grain?: unknown; ags?: unknown; parentLabel?: string | null };
}): BoundVerlauf | null {
  const latest = input.latest;
  if (!latest) return null;

  if (latest.region) {
    if (!patternMatchesMarkedRegion(latest.region, input.marked)) return null;
    return toBound(latest, latest.region, input.marked);
  }

  if (!input.run || !runMatchesMarkedRegion(input.run, input.marked)) return null;
  return toBound(latest, input.run.input.region, input.marked);
}

/**
 * Load the newest completed pattern for the marked geoKey.
 * 404 / missing geoKey / a run of another region → null (empty state).
 * Other HTTP errors are thrown so the page can show the failure copy.
 */
export async function loadPatternForMarkedRegion(
  api: Pick<RuehrApi, "getAnalysisPattern" | "getAnalysisRun">,
  marked: (PlaceRef & { level?: unknown; grain?: unknown; ags?: unknown; parentLabel?: string | null }) | null,
): Promise<BoundVerlauf | null> {
  const geoKey = patternQueryGeoKey(marked);
  if (!marked || !geoKey) return null;

  const latest = await api.getAnalysisPattern({ geoKey });
  if (!latest) return null;

  let run: AnalysisRun | null = null;
  if (!latest.region) {
    try {
      run = await api.getAnalysisRun(latest.runId);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  return bindPatternToMarkedRegion({ latest, run, marked });
}

function toBound(
  latest: AnalysisPatternResponse,
  region: AnalysisPatternRegion | PlaceRef,
  marked: PlaceRef & { level?: unknown; grain?: unknown; ags?: unknown; parentLabel?: string | null },
): BoundVerlauf {
  return {
    runId: latest.runId,
    createdAt: latest.createdAt,
    region: mergeStandRegion(region, marked),
    pattern: withRegionSeries(latest.pattern, marked),
  };
}

function withRegionSeries(pattern: AnalysisPattern, marked: PlaceRef): AnalysisPattern {
  if (!pattern.yearlySeries) return pattern;
  return { ...pattern, yearlySeries: yearlySeriesForRegion(pattern.yearlySeries, marked) };
}

function mergeStandRegion(
  region: AnalysisPatternRegion | PlaceRef,
  marked: PlaceRef & { level?: unknown; grain?: unknown; ags?: unknown; parentLabel?: string | null },
): AnalysisPatternRegion {
  const label = trimLabel(region.label) || catalogPlaceName(marked) || trimLabel(marked.label);
  const regionGrain = "grain" in region && isGrain(region.grain) ? region.grain : undefined;
  const markedGrain = isGrain(marked.grain) ? marked.grain : undefined;
  return {
    label,
    geoKey: typeof region.geoKey === "string" ? region.geoKey : marked.geoKey,
    level: catalogLevelOf("level" in region ? region.level : undefined) ?? catalogLevelOf(marked.level),
    parentLabel: catalogParentName(region) ?? catalogParentName(marked),
    grain: regionGrain ?? markedGrain,
  };
}

function trimLabel(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

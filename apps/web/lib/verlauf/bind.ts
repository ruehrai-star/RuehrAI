import type { AnalysisPattern, AnalysisRun, YearlySeries } from "@ruehrai/api-contracts";
import { ApiError, isGrain, type AnalysisPatternRegion, type AnalysisPatternResponse } from "../api/types.ts";
import type { RuehrApi } from "../api/client.ts";
import {
  formatRunRegionLabel,
  regionsFromRunInput,
  runRegionEntryLabel,
  type RunRegionSource,
} from "../analysis/run-label.ts";
import { catalogLevelOf, catalogParentName, catalogPlaceName } from "../format.ts";
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
  /** All Zielregionen on the run snapshot, newest first. */
  regions: AnalysisPatternRegion[];
  pattern: AnalysisPattern;
}

export function patternQueryGeoKey(region: PlaceRef | null | undefined): string | null {
  if (!region || typeof region.geoKey !== "string") return null;
  const trimmed = region.geoKey.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Visible region name for the Stand line and header.
 * `Name (Gemeinde)` from parentLabel, or the name alone. Never a key or level code.
 */
export function standRegionLabel(
  region: (PlaceRef & { level?: unknown; grain?: unknown; ags?: unknown; parentLabel?: string | null }) | null | undefined,
): string {
  return runRegionEntryLabel(region);
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

export function formatStandPrefix(createdAt: string): string {
  return `Stand: Lauf vom ${formatStandDate(createdAt)} für `;
}

/** `Stand: Lauf vom [Datum, Uhrzeit] für [run label].` Uses the collapsed summary when many. */
export function formatStandLine(
  createdAt: string,
  region:
    | RunRegionSource
    | readonly RunRegionSource[]
    | null
    | undefined,
): string {
  const regions = Array.isArray(region) ? region : region ? [region] : [];
  return `${formatStandPrefix(createdAt)}${formatRunRegionLabel(regions).summary}`;
}

export function standRegionsOf(bound: BoundVerlauf | null | undefined): AnalysisPatternRegion[] {
  if (!bound) return [];
  return bound.regions.length > 0 ? bound.regions : bound.region ? [bound.region] : [];
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

  const bound = bindPatternToMarkedRegion({ latest, run, marked });
  if (!bound) return null;
  return withRunRegions(bound, run ?? (await readRunRegions(api, bound.runId)));
}

function toBound(
  latest: AnalysisPatternResponse,
  region: AnalysisPatternRegion | PlaceRef,
  marked: PlaceRef & { level?: unknown; grain?: unknown; ags?: unknown; parentLabel?: string | null },
): BoundVerlauf {
  const merged = mergeStandRegion(region, marked);
  return {
    runId: latest.runId,
    createdAt: latest.createdAt,
    region: merged,
    regions: [merged],
    pattern: withRegionSeries(latest.pattern, marked),
  };
}

async function readRunRegions(
  api: Pick<RuehrApi, "getAnalysisRun">,
  runId: string,
): Promise<AnalysisRun | null> {
  try {
    return await api.getAnalysisRun(runId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    return null;
  }
}

function withRunRegions(bound: BoundVerlauf, run: AnalysisRun | null): BoundVerlauf {
  if (!run) return bound;
  const fromRun = regionsFromRunInput(run.input).map(snapshotRegion).filter((region) => region.label.length > 0);
  return { ...bound, regions: fromRun.length > 0 ? fromRun : bound.regions };
}

function withRegionSeries(pattern: AnalysisPattern, marked: PlaceRef): AnalysisPattern {
  if (!pattern.yearlySeries) return pattern;
  return { ...pattern, yearlySeries: yearlySeriesForRegion(pattern.yearlySeries, marked) };
}

function snapshotRegion(region: AnalysisPatternRegion | PlaceRef): AnalysisPatternRegion {
  const grain = "grain" in region && isGrain(region.grain) ? region.grain : undefined;
  return {
    label: trimLabel(region.label) || catalogPlaceName(region) || "",
    geoKey: typeof region.geoKey === "string" ? region.geoKey : null,
    level: catalogLevelOf("level" in region ? region.level : undefined),
    parentLabel: catalogParentName(region),
    grain,
  };
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
    geoKey: typeof region.geoKey === "string" ? region.geoKey : (marked.geoKey ?? null),
    level: catalogLevelOf("level" in region ? region.level : undefined) ?? catalogLevelOf(marked.level),
    parentLabel: catalogParentName(region) ?? catalogParentName(marked),
    grain: regionGrain ?? markedGrain,
  };
}

function trimLabel(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

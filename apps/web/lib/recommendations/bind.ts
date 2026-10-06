import type { AnalysisRun } from "@ruehrai/api-contracts";
import type { RuehrApi } from "../api/client.ts";
import { analysisFailureFromHttp, analysisFailureMessage } from "../analysis/failure.ts";
import { isInFlightStatus, isTransientPollError, pollAnalysisRun, type InFlightRunStatus, type PollAnalysisOptions } from "../analysis/poll.ts";
import {
  bindPatternToMarkedRegion,
  patternQueryGeoKey,
  runIsForMarkedRegion,
  withRunSnapshot,
} from "../verlauf/bind.ts";
import type { BoundVerlauf } from "../verlauf/bind.ts";
import type { PlaceRef } from "../locations/regions.ts";
import { recommendationSetCoversMarkedRegion } from "./target-region-key.ts";
import { ApiError, type RecommendationSet } from "../api/types.ts";

/**
 * Load a stored recommendation set for a completed analysis run.
 * GET only — never POST /recommendations, never ranks on read.
 */
export async function loadRecommendationsForRun(
  api: Pick<RuehrApi, "getRecommendations">,
  runId: string | null | undefined,
): Promise<RecommendationSet | null> {
  const id = typeof runId === "string" ? runId.trim() : "";
  if (!id) return null;
  return api.getRecommendations({ runId: id });
}

export function recommendationSetForRun(
  set: RecommendationSet | null | undefined,
  runId: string | null | undefined,
): RecommendationSet | null {
  if (!set || !runId) return null;
  return set.runId === runId ? set : null;
}

export type TrefferlisteBind =
  | { kind: "empty" }
  | { kind: "ready"; bound: BoundVerlauf; set: RecommendationSet | null }
  | { kind: "in_flight"; runId: string; status: InFlightRunStatus }
  | { kind: "failed"; runId: string; message: string };

type MarkedRegion = (PlaceRef & {
  level?: unknown;
  grain?: unknown;
  ags?: unknown;
  parentLabel?: string | null;
}) | null;

/**
 * Bind Trefferliste to the marked Zielregion.
 * GET /analysis/pattern?geoKey= plus optional GET of an in-flight run.
 * Never POST /analysis/runs and never POST /recommendations.
 */
export async function bindTrefferlisteForRegion(
  api: Pick<RuehrApi, "getAnalysisPattern" | "getAnalysisRun" | "getRecommendations">,
  marked: MarkedRegion,
  inflightRunId?: string | null,
): Promise<TrefferlisteBind> {
  const inflight = typeof inflightRunId === "string" ? inflightRunId.trim() : "";
  if (inflight) {
    const live = await readKnownRun(api, inflight);
    if (live.kind === "in_flight" || live.kind === "failed") return live;
  }

  const bound = await bindCompletedSetForMarkedRegion(api, marked);
  if (!bound) return { kind: "empty" };
  return { kind: "ready", bound: bound.bound, set: bound.set };
}

async function readKnownRun(
  api: Pick<RuehrApi, "getAnalysisRun">,
  runId: string,
): Promise<Extract<TrefferlisteBind, { kind: "in_flight" | "failed" }> | { kind: "other" }> {
  let run: AnalysisRun;
  try {
    run = await api.getAnalysisRun(runId);
  } catch (error) {
    if (isTransientPollError(error)) {
      return { kind: "in_flight", runId, status: "running" };
    }
    if (error instanceof ApiError) {
      return { kind: "failed", runId, message: analysisFailureFromHttp(error.status, error.message) };
    }
    throw error;
  }
  if (isInFlightStatus(run.status)) {
    return { kind: "in_flight", runId: run.id, status: run.status };
  }
  if (run.status === "failed") {
    return { kind: "failed", runId: run.id, message: analysisFailureMessage(run.failureReason) };
  }
  return { kind: "other" };
}

/**
 * Bind a stored set when the marked region is on the run snapshot or on
 * `set.targetRegions`.
 */
async function bindCompletedSetForMarkedRegion(
  api: Pick<RuehrApi, "getAnalysisPattern" | "getAnalysisRun" | "getRecommendations">,
  marked: MarkedRegion,
): Promise<{ bound: BoundVerlauf; set: RecommendationSet | null } | null> {
  const geoKey = patternQueryGeoKey(marked);
  if (!marked || !geoKey) return null;

  const latest = await api.getAnalysisPattern({ geoKey });
  if (!latest) return null;

  let run: AnalysisRun | null = null;
  try {
    run = await api.getAnalysisRun(latest.runId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }

  const set = await loadRecommendationsForRun(api, latest.runId);
  const runOk = Boolean(run && runIsForMarkedRegion(run, marked));
  const setOk = recommendationSetCoversMarkedRegion(set, marked);
  if (!runOk && !setOk) return null;

  const bound = bindPatternToMarkedRegion({
    latest,
    run,
    marked,
    allowMarkedFallback: setOk,
  });
  if (!bound) return null;
  return { bound: run ? withRunSnapshot(bound, run) : bound, set };
}

/** Load the set only after the run is completed. GET /recommendations?runId= is 404 until then. */
export async function loadTrefferlisteAfterCompletedRun(
  api: Pick<RuehrApi, "getAnalysisPattern" | "getAnalysisRun" | "getRecommendations">,
  runId: string,
  marked: MarkedRegion,
): Promise<Extract<TrefferlisteBind, { kind: "ready" | "empty" }>> {
  const next = await bindCompletedSetForMarkedRegion(api, marked);
  if (!next) return { kind: "empty" };
  const set =
    next.set && next.set.runId === next.bound.runId
      ? next.set
      : await loadRecommendationsForRun(api, next.bound.runId);
  return { kind: "ready", bound: next.bound, set };
}

export async function pollTrefferlisteRun(
  api: Pick<RuehrApi, "getAnalysisPattern" | "getAnalysisRun" | "getRecommendations">,
  runId: string,
  marked: MarkedRegion,
  options?: PollAnalysisOptions,
): Promise<TrefferlisteBind | { kind: "deadline" } | { kind: "aborted" }> {
  const outcome = await pollAnalysisRun(api, runId, options);
  if (outcome.kind === "aborted" || outcome.kind === "deadline") return outcome;
  if (outcome.kind === "failed") return { kind: "failed", runId, message: outcome.message };
  return loadTrefferlisteAfterCompletedRun(api, outcome.run.id, marked);
}

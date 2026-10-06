import type { AnalysisRun } from "@ruehrai/api-contracts";
import type { RuehrApi } from "../api/client.ts";
import { ApiError } from "../api/types.ts";
import type { RecommendationSet } from "../api/types.ts";
import { analysisFailureFromHttp, analysisFailureMessage } from "../analysis/failure.ts";
import { isInFlightStatus, isTransientPollError, pollAnalysisRun, type InFlightRunStatus, type PollAnalysisOptions } from "../analysis/poll.ts";
import { loadPatternForMarkedRegion } from "../verlauf/bind.ts";
import type { BoundVerlauf } from "../verlauf/bind.ts";
import type { PlaceRef } from "../locations/regions.ts";

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
  options?: { startedRunId?: string | null },
): Promise<TrefferlisteBind> {
  const inflight = typeof inflightRunId === "string" ? inflightRunId.trim() : "";
  if (inflight) {
    const live = await readKnownRun(api, inflight);
    if (live.kind === "in_flight" || live.kind === "failed") return live;
  }

  const bound = await loadPatternForMarkedRegion(api, marked, { startedRunId: options?.startedRunId });
  if (!bound) return { kind: "empty" };
  const set = await loadRecommendationsForRun(api, bound.runId);
  return { kind: "ready", bound, set };
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

/** Load the set only after the run is completed. GET /recommendations?runId= is 404 until then. */
export async function loadTrefferlisteAfterCompletedRun(
  api: Pick<RuehrApi, "getAnalysisPattern" | "getAnalysisRun" | "getRecommendations">,
  runId: string,
  marked: MarkedRegion,
): Promise<Extract<TrefferlisteBind, { kind: "ready" | "empty" }>> {
  const bound = await loadPatternForMarkedRegion(api, marked, { startedRunId: runId });
  const set = await loadRecommendationsForRun(api, runId);
  if (!bound) return { kind: "empty" };
  return { kind: "ready", bound, set: set && set.runId === bound.runId ? set : await loadRecommendationsForRun(api, bound.runId) };
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

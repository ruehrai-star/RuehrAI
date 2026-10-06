import type { RuehrApi } from "../api/client.ts";
import type { RecommendationSet } from "../api/types.ts";

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

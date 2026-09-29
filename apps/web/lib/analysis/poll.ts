import type { AnalysisRun } from "@ruehrai/api-contracts";
import type { RuehrApi } from "../api/client.ts";
import { ApiError } from "../api/types.ts";
import { ANALYSIS_COPY } from "./model.ts";

export interface PollAnalysisOptions {
  attempts?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Read `GET /analysis/runs/{id}` until the contract status `completed` is present.
 * A 404 is the only "not stored yet" signal in OpenAPI 0.3.0, so that status is
 * retried. Any other error stops the poll.
 */
export async function pollAnalysisRun(
  api: Pick<RuehrApi, "getAnalysisRun">,
  id: string,
  options: PollAnalysisOptions = {},
): Promise<AnalysisRun> {
  const attempts = Math.max(1, options.attempts ?? 4);
  const intervalMs = options.intervalMs ?? 400;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const run = await api.getAnalysisRun(id);
      if (run.status === "completed") return run;
    } catch (error) {
      lastError = error;
      const missing = error instanceof ApiError && error.status === 404;
      if (!missing) throw error;
    }
    if (attempt < attempts - 1) await sleep(intervalMs);
  }

  if (lastError instanceof Error) throw lastError;
  throw new ApiError(ANALYSIS_COPY.failed, 0);
}

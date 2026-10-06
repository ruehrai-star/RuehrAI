import type { AnalysisRun } from "@ruehrai/api-contracts";
import type { RuehrApi } from "../api/client.ts";
import { ApiError } from "../api/types.ts";
import { ANALYSIS_FAILURE_COPY, analysisFailureFromHttp, analysisFailureMessage } from "./failure.ts";

export const POLL_INITIAL_INTERVAL_MS = 2_000;
export const POLL_MAX_INTERVAL_MS = 5_000;
export const POLL_DEADLINE_MS = 3 * 60 * 1_000;

export type InFlightRunStatus = "queued" | "running";

export type PollOutcome =
  | { kind: "completed"; run: AnalysisRun }
  | { kind: "failed"; run: AnalysisRun | null; message: string }
  | { kind: "deadline" }
  | { kind: "aborted" };

export interface PollAnalysisOptions {
  signal?: AbortSignal;
  intervalMs?: number;
  maxIntervalMs?: number;
  deadlineMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onStatus?: (status: InFlightRunStatus) => void;
}

export function isInFlightStatus(status: string | null | undefined): status is InFlightRunStatus {
  return status === "queued" || status === "running";
}

export function nextPollInterval(currentMs: number, maxMs = POLL_MAX_INTERVAL_MS): number {
  const current = Number.isFinite(currentMs) && currentMs > 0 ? currentMs : POLL_INITIAL_INTERVAL_MS;
  return Math.min(maxMs, current + 1_000);
}

export function deadlineExceeded(elapsedMs: number, deadlineMs = POLL_DEADLINE_MS): boolean {
  return elapsedMs >= deadlineMs;
}

export function interpretRun(
  run: Pick<AnalysisRun, "status" | "failureReason">,
): { kind: "in_flight"; status: InFlightRunStatus } | { kind: "completed" } | { kind: "failed"; message: string } {
  if (isInFlightStatus(run.status)) return { kind: "in_flight", status: run.status };
  if (run.status === "failed") return { kind: "failed", message: analysisFailureMessage(run.failureReason) };
  return { kind: "completed" };
}

export async function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted || ms <= 0) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    if (!signal) return;
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Read `GET /analysis/runs/{id}` until the run is terminal, the client
 * deadline elapses, or `signal` aborts. `queued` and `running` keep polling
 * with a growing interval. A 404 is retried (row not visible yet). A completed
 * 200 keeps working for the older synchronous POST.
 */
export async function pollAnalysisRun(
  api: Pick<RuehrApi, "getAnalysisRun">,
  id: string,
  options: PollAnalysisOptions = {},
): Promise<PollOutcome> {
  const started = (options.now ?? Date.now)();
  const now = options.now ?? Date.now;
  const deadlineMs = options.deadlineMs ?? POLL_DEADLINE_MS;
  const maxIntervalMs = options.maxIntervalMs ?? POLL_MAX_INTERVAL_MS;
  const sleep = options.sleep ?? sleepMs;
  let intervalMs = options.intervalMs ?? POLL_INITIAL_INTERVAL_MS;
  const signal = options.signal;

  while (true) {
    if (signal?.aborted) return { kind: "aborted" };
    if (deadlineExceeded(now() - started, deadlineMs)) return { kind: "deadline" };

    try {
      const run = await api.getAnalysisRun(id);
      if (signal?.aborted) return { kind: "aborted" };
      const interpreted = interpretRun(run);
      if (interpreted.kind === "completed") return { kind: "completed", run };
      if (interpreted.kind === "failed") return { kind: "failed", run, message: interpreted.message };
      options.onStatus?.(interpreted.status);
    } catch (error) {
      if (signal?.aborted) return { kind: "aborted" };
      const missing = error instanceof ApiError && error.status === 404;
      if (!missing) {
        if (error instanceof ApiError) {
          return {
            kind: "failed",
            run: null,
            message: analysisFailureFromHttp(error.status, error.message),
          };
        }
        throw error;
      }
    }

    if (deadlineExceeded(now() - started, deadlineMs)) return { kind: "deadline" };
    await sleep(intervalMs, signal);
    if (signal?.aborted) return { kind: "aborted" };
    intervalMs = nextPollInterval(intervalMs, maxIntervalMs);
  }
}

export function deadlineMessage(): string {
  return ANALYSIS_FAILURE_COPY.deadline;
}

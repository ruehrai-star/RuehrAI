import type { AnalysisRun, AnalysisRunStatus } from "@ruehrai/api-contracts";
import type { RuehrApi } from "../api/client.ts";
import { ApiError } from "../api/types.ts";
import { analysisFailureFromHttp, analysisFailureMessage, clientDeadlineMessage } from "./failure.ts";

/** Official 0.19.0 poll interval. Backoff after transient GET errors rises toward this. */
export const POLL_INTERVAL_MS = 2_000;
export const POLL_BACKOFF_MAX_MS = 10_000;
/**
 * Client safety net from start or resume. STAGE's gateway idle limit is about
 * 60 s (not 150 s); a 502/504 on GET is therefore not a final run state.
 */
export const POLL_DEADLINE_MS = 3 * 60 * 1_000;

export type InFlightRunStatus = Extract<AnalysisRunStatus, "queued" | "running">;

export type PollOutcome =
  | { kind: "completed"; run: AnalysisRun }
  | { kind: "failed"; run: AnalysisRun | null; message: string }
  | { kind: "deadline" }
  | { kind: "aborted" };

export interface PollAnalysisOptions {
  signal?: AbortSignal;
  intervalMs?: number;
  deadlineMs?: number;
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onStatus?: (status: InFlightRunStatus) => void;
}

export function isInFlightStatus(status: string | null | undefined): status is InFlightRunStatus {
  return status === "queued" || status === "running";
}

export function deadlineExceeded(elapsedMs: number, deadlineMs = POLL_DEADLINE_MS): boolean {
  return elapsedMs >= deadlineMs;
}

/**
 * GET `/analysis/runs/{id}` 502/504, a network failure, or an abort of the
 * fetch (not the poll `signal`) is not a terminal run state.
 */
export function isTransientPollError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 502 || error.status === 504 || error.status === 0;
  }
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  return name === "AbortError" || name === "TypeError";
}

/** 2 s while the run is in flight. After transient errors, double toward ~10 s with jitter. */
export function pollDelayMs(
  errorStreak: number,
  options: { intervalMs?: number; maxMs?: number; random?: () => number } = {},
): number {
  const min = options.intervalMs ?? POLL_INTERVAL_MS;
  if (errorStreak <= 0) return min;
  const max = options.maxMs ?? POLL_BACKOFF_MAX_MS;
  const random = options.random ?? Math.random;
  const exp = Math.min(max, min * 2 ** errorStreak);
  const jitter = exp * 0.2 * (random() * 2 - 1);
  return Math.round(Math.min(max, Math.max(min, exp + jitter)));
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
 * Read `GET /analysis/runs/{id}` until the run is terminal, the 180 s client
 * `POLL_DEADLINE` from start or resume elapses, or `signal` aborts.
 *
 * Steady interval is ~2 s. 502, 504, and network/abort errors keep the poll
 * alive with backoff up to ~10 s plus jitter. The UI must keep showing
 * `Analyse läuft …` for those — they are not `failed`.
 *
 * Timeout copy is only for backend `failureReason=timeout` or this deadline.
 * 404 (unknown run) and a definitive `failed` status stay final.
 *
 * POST `/analysis/runs` is not retried on 502/504. A timed-out POST may already
 * have created a run; retrying would start a second one, and there is no list
 * endpoint to recover the id. Keep a single POST.
 */
export async function pollAnalysisRun(
  api: Pick<RuehrApi, "getAnalysisRun">,
  id: string,
  options: PollAnalysisOptions = {},
): Promise<PollOutcome> {
  const started = (options.now ?? Date.now)();
  const now = options.now ?? Date.now;
  const deadlineMs = options.deadlineMs ?? POLL_DEADLINE_MS;
  const sleep = options.sleep ?? sleepMs;
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const signal = options.signal;
  let errorStreak = 0;
  let lastStatus: InFlightRunStatus = "running";

  while (true) {
    if (signal?.aborted) return { kind: "aborted" };
    if (deadlineExceeded(now() - started, deadlineMs)) return { kind: "deadline" };

    try {
      const run = await api.getAnalysisRun(id);
      if (signal?.aborted) return { kind: "aborted" };
      const interpreted = interpretRun(run);
      if (interpreted.kind === "completed") return { kind: "completed", run };
      if (interpreted.kind === "failed") return { kind: "failed", run, message: interpreted.message };
      lastStatus = interpreted.status;
      errorStreak = 0;
      options.onStatus?.(interpreted.status);
    } catch (error) {
      if (signal?.aborted) return { kind: "aborted" };
      if (isTransientPollError(error)) {
        errorStreak += 1;
        options.onStatus?.(lastStatus);
      } else if (error instanceof ApiError) {
        return {
          kind: "failed",
          run: null,
          message: analysisFailureFromHttp(error.status, error.message),
        };
      } else {
        throw error;
      }
    }

    if (deadlineExceeded(now() - started, deadlineMs)) return { kind: "deadline" };
    await sleep(pollDelayMs(errorStreak, { intervalMs, random: options.random }), signal);
    if (signal?.aborted) return { kind: "aborted" };
  }
}

export function deadlineMessage(): string {
  return clientDeadlineMessage();
}

/** Start / restart stay off while any run is queued, running, or a POST is in flight. */
export function analysisStartLocked(input: {
  starting?: boolean;
  runStatus?: string | null;
  otherInFlight?: boolean;
}): boolean {
  return Boolean(
    input.starting ||
      input.otherInFlight ||
      input.runStatus === "queued" ||
      input.runStatus === "running",
  );
}

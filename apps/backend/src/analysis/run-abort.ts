import { analysisDeadlineError, isAnalysisDeadlineError } from "./failure-reason";

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal) return;
  if (typeof signal.throwIfAborted === "function") {
    try {
      signal.throwIfAborted();
      return;
    } catch (error) {
      throw remapAbort(error, signal);
    }
  }
  if (signal.aborted) throw remapAbort(signal.reason, signal);
}

export function isAbortLike(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (isAnalysisDeadlineError(error)) return true;
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? (error as { name?: unknown }).name : undefined;
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  return name === "AbortError" || code === "ABORT_ERR" || code === "ANALYSIS_INTERRUPTED";
}

export function remapAbort(error: unknown, signal?: AbortSignal): Error {
  const reason = signal?.reason ?? error;
  if (isAnalysisDeadlineError(reason) || isAnalysisDeadlineError(error)) {
    return analysisDeadlineError();
  }
  if (isInterrupted(reason) || isInterrupted(error)) {
    return Object.assign(new Error("analysis run interrupted"), { code: "ANALYSIS_INTERRUPTED" });
  }
  if (reason instanceof Error) return reason;
  if (error instanceof Error) return error;
  return analysisDeadlineError();
}

export function interruptedError(): Error {
  return Object.assign(new Error("analysis run interrupted"), { code: "ANALYSIS_INTERRUPTED" });
}

function isInterrupted(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return "code" in error && (error as { code?: unknown }).code === "ANALYSIS_INTERRUPTED";
}

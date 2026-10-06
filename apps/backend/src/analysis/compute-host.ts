import { existsSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { readAnalysisUseWorkerThreads, readAnalysisYieldMs } from "./analysis-env";
import { ComputeJob, ComputeResult, handleComputeJobSync } from "./compute-job";
import { analysisDeadlineError } from "./failure-reason";
import { isAbortLike, throwIfAborted } from "./run-abort";
import { yieldEventLoop } from "../common/safe-array";
import { YearlySeries, buildAllMetricSeries, indexSeriesDocs } from "./yearly-series";
import { rankTeilflaechen } from "../recommendations/score";
import { capCandidatesForSeries } from "../recommendations/candidate-cap";

let workerFallbackNoted = false;

export async function runComputeJob(job: ComputeJob, signal?: AbortSignal): Promise<ComputeResult> {
  throwIfAborted(signal);
  const heavy = isHeavyJob(job);
  if (heavy && readAnalysisUseWorkerThreads()) {
    try {
      return await runInWorker(job, signal);
    } catch (error) {
      if (isAbortLike(error, signal)) throw error instanceof Error ? error : analysisDeadlineError();
      noteFallback(error);
    }
  }
  return runInProcess(job, signal);
}

/**
 * Worker-threads are the default for CPU work (YearlySeries, ranking).
 * Tiny Jest fixtures stay on-thread so a Worker boot does not dominate the case.
 * Cap stays cheap and usually in-process; a very large pool still goes off-thread.
 */
function isHeavyJob(job: ComputeJob): boolean {
  if (job.type === "yearlySeries") return job.resolved.length >= 8 || job.docs.length >= 40;
  if (job.type === "rank") return job.candidates.length >= 24;
  return job.candidates.length >= 80;
}

async function runInWorker(job: ComputeJob, signal?: AbortSignal): Promise<ComputeResult> {
  throwIfAborted(signal);
  const worker = spawnComputeWorker();
  return new Promise<ComputeResult>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      void worker.terminate();
      finish(analysisDeadlineError());
    };
    const finish = (error: Error | null, result?: ComputeResult) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(result!);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    worker.once("message", (message: { ok?: boolean; result?: ComputeResult; error?: { message?: string; code?: unknown } }) => {
      void worker.terminate();
      if (message?.ok && message.result) {
        finish(null, message.result);
        return;
      }
      const err = Object.assign(new Error(message?.error?.message ?? "compute worker failed"), {
        code: message?.error?.code,
      });
      finish(err);
    });
    worker.once("error", (error) => {
      finish(error instanceof Error ? error : new Error(String(error)));
    });
    worker.once("exit", (code) => {
      if (settled) return;
      if (signal?.aborted) {
        finish(analysisDeadlineError());
        return;
      }
      finish(new Error(`compute worker exited with code ${code}`));
    });
    worker.postMessage(job);
  });
}

/**
 * Nest `dist/` ships `compute.worker.js`. Jest / ts-node still see `.ts`.
 * `execArgv: []` drops Jest's register hooks so the worker is a plain Node process.
 */
function spawnComputeWorker(): Worker {
  const jsPath = path.join(__dirname, "compute.worker.js");
  if (existsSync(jsPath)) return new Worker(jsPath, { execArgv: [] });
  const tsPath = path.join(__dirname, "compute.worker.ts");
  if (!existsSync(tsPath)) {
    throw new Error(`compute worker entry missing (${jsPath})`);
  }
  try {
    const tsxApi = require.resolve("tsx/cjs/api");
    return new Worker(
      `"use strict";require(${JSON.stringify(tsxApi)}).register();require(${JSON.stringify(tsPath)});`,
      { eval: true, execArgv: [] },
    );
  } catch {
    return new Worker(tsPath, { execArgv: ["--import", "tsx"] });
  }
}

async function runInProcess(job: ComputeJob, signal?: AbortSignal): Promise<ComputeResult> {
  throwIfAborted(signal);
  if (job.type === "yearlySeries") {
    return buildYearlySeriesChunked(job, signal);
  }
  if (job.type === "rank") {
    throwIfAborted(signal);
    await yieldEventLoop();
    const ranked = rankTeilflaechen(job.candidates, job.series, job.criteria, job.regions);
    await yieldEventLoop();
    throwIfAborted(signal);
    return { type: "rank", ranked };
  }
  throwIfAborted(signal);
  const capped = capCandidatesForSeries(job.candidates, job.regions, job.cap);
  return {
    type: "cap",
    selected: capped.selected,
    candidateCount: capped.candidateCount,
    cappedCount: capped.cappedCount,
    truncated: capped.truncated,
  };
}

async function buildYearlySeriesChunked(
  job: Extract<ComputeJob, { type: "yearlySeries" }>,
  signal?: AbortSignal,
): Promise<Extract<ComputeResult, { type: "yearlySeries" }>> {
  const yieldMs = readAnalysisYieldMs();
  const indexStarted = Date.now();
  const index = indexSeriesDocs(job.docs);
  let maxSyncMs = Date.now() - indexStarted;
  await yieldEventLoop();
  throwIfAborted(signal);

  const series: YearlySeries[] = [];
  let chunks = 1;
  let blockStart = Date.now();
  for (let i = 0; i < job.resolved.length; i += 1) {
    throwIfAborted(signal);
    const chunk = buildAllMetricSeries([job.resolved[i]!], index, new Date(job.asOfIso));
    series.push(...chunk);
    const elapsed = Date.now() - blockStart;
    if (elapsed >= yieldMs || (i + 1) % 8 === 0) {
      if (elapsed > maxSyncMs) maxSyncMs = elapsed;
      chunks += 1;
      await yieldEventLoop();
      throwIfAborted(signal);
      blockStart = Date.now();
    }
  }
  const tail = Date.now() - blockStart;
  if (tail > maxSyncMs) maxSyncMs = tail;
  throwIfAborted(signal);
  await yieldEventLoop();
  return {
    type: "yearlySeries",
    series,
    stats: {
      docs: job.docs.length,
      regions: job.resolved.length,
      chunks,
      maxSyncMs,
    },
  };
}

function noteFallback(error: unknown): void {
  if (workerFallbackNoted) return;
  workerFallbackNoted = true;
  const detail = error instanceof Error ? error.message : "unknown error";
  // eslint-disable-next-line no-console
  console.warn(`Analysis compute worker unavailable (${detail}); using cooperative chunking.`);
}

/** Test helper: in-process sync path without yielding. */
export function runComputeJobSync(job: ComputeJob): ComputeResult {
  return handleComputeJobSync(job);
}

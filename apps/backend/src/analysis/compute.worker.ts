import { parentPort } from "node:worker_threads";
import { ComputeJob, handleComputeJobSync } from "./compute-job";

if (!parentPort) {
  throw new Error("compute.worker must run as a worker thread");
}

parentPort.on("message", (job: ComputeJob) => {
  try {
    parentPort!.postMessage({ ok: true, result: handleComputeJobSync(job) });
  } catch (error) {
    parentPort!.postMessage({
      ok: false,
      error: {
        message: error instanceof Error ? error.message : "compute worker failed",
        code: error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined,
      },
    });
  }
});

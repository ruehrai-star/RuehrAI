import assert from "node:assert/strict";
import { test } from "node:test";
import type { AnalysisRun } from "@ruehrai/api-contracts";
import { ApiError } from "../api/types.ts";
import { ANALYSIS_FAILURE_COPY, analysisFailureMessage, clientDeadlineMessage } from "./failure.ts";
import {
  POLL_BACKOFF_MAX_MS,
  POLL_DEADLINE_MS,
  POLL_INTERVAL_MS,
  analysisStartLocked,
  deadlineExceeded,
  deadlineMessage,
  interpretRun,
  isTransientPollError,
  pollAnalysisRun,
  pollDelayMs,
} from "./poll.ts";

const completed = { id: "9", status: "completed" } as AnalysisRun;

test("poll interval is 2s and the client safety deadline is 3 minutes", () => {
  assert.equal(POLL_INTERVAL_MS, 2_000);
  assert.equal(POLL_DEADLINE_MS, 180_000);
  assert.equal(deadlineExceeded(179_999), false);
  assert.equal(deadlineExceeded(180_000), true);
  assert.equal(deadlineMessage(), clientDeadlineMessage());
});

test("interpretRun keeps queued and running in flight and maps failed reasons", () => {
  assert.deepEqual(interpretRun({ status: "queued" }), { kind: "in_flight", status: "queued" });
  assert.deepEqual(interpretRun({ status: "running" }), { kind: "in_flight", status: "running" });
  assert.deepEqual(interpretRun({ status: "completed" }), { kind: "completed" });
  const failed = interpretRun({ status: "failed", failureReason: "timeout" });
  assert.equal(failed.kind, "failed");
  if (failed.kind === "failed") {
    assert.equal(failed.message, analysisFailureMessage("timeout"));
  }
  const interrupted = interpretRun({ status: "failed", failureReason: "interrupted" });
  assert.equal(interrupted.kind, "failed");
  if (interrupted.kind === "failed") {
    assert.equal(interrupted.message, analysisFailureMessage("interrupted"));
  }
  const unknown = interpretRun({
    status: "failed",
    failureReason: "brain_search_failed" as AnalysisRun["failureReason"],
  });
  assert.equal(unknown.kind, "failed");
  if (unknown.kind === "failed") {
    assert.equal(unknown.message, analysisFailureMessage("internal_error"));
    assert.equal(unknown.message.includes("brain"), false);
  }
});

test("poll returns immediately when the run is already completed", async () => {
  let calls = 0;
  const settled = await pollAnalysisRun(
    {
      getAnalysisRun: async (id) => {
        calls += 1;
        assert.equal(id, "9");
        return completed;
      },
    },
    "9",
    { sleep: async () => {}, now: () => 0, deadlineMs: 60_000 },
  );
  assert.deepEqual(settled, { kind: "completed", run: completed });
  assert.equal(calls, 1);
});

test("poll keeps reading while queued then running, then returns completed", async () => {
  const seen: string[] = [];
  const sleeps: number[] = [];
  const settled = await pollAnalysisRun(
    {
      getAnalysisRun: async () => {
        if (seen.length === 0) {
          seen.push("queued");
          return { ...completed, status: "queued" };
        }
        if (seen.length === 1) {
          seen.push("running");
          return { ...completed, status: "running" };
        }
        seen.push("completed");
        return completed;
      },
    },
    "9",
    {
      intervalMs: 2_000,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      now: () => 0,
      deadlineMs: 60_000,
    },
  );
  assert.equal(settled.kind, "completed");
  assert.deepEqual(seen, ["queued", "running", "completed"]);
  assert.deepEqual(sleeps, [2_000, 2_000]);
});

test("poll stops on a failed run with a mapped German reason", async () => {
  const settled = await pollAnalysisRun(
    {
      getAnalysisRun: async () =>
        ({
          ...completed,
          status: "failed",
          failureReason: "timeout",
        }) as AnalysisRun,
    },
    "9",
    { sleep: async () => {}, now: () => 0 },
  );
  assert.equal(settled.kind, "failed");
  if (settled.kind === "failed") {
    assert.equal(settled.message, analysisFailureMessage("timeout"));
    assert.equal(settled.run?.id, "9");
  }
});

test("poll treats a 404 as a generic failure and does not retry", async () => {
  let calls = 0;
  const settled = await pollAnalysisRun(
    {
      getAnalysisRun: async () => {
        calls += 1;
        throw new ApiError("Die Analyse wurde nicht gefunden.", 404);
      },
    },
    "99",
    { sleep: async () => {}, now: () => 0, deadlineMs: 60_000 },
  );
  assert.equal(settled.kind, "failed");
  if (settled.kind === "failed") {
    assert.equal(settled.message, analysisFailureMessage("internal_error"));
    assert.equal(settled.message.includes("99"), false);
    assert.equal(settled.message.includes("404"), false);
  }
  assert.equal(calls, 1);
});

test("poll stops on errors other than a missing run", async () => {
  let calls = 0;
  const settled = await pollAnalysisRun(
    {
      getAnalysisRun: async () => {
        calls += 1;
        throw new ApiError("Anmeldung erforderlich.", 401);
      },
    },
    "9",
    { sleep: async () => {}, now: () => 0 },
  );
  assert.equal(settled.kind, "failed");
  assert.equal(calls, 1);
});

test("poll stops at the client deadline while the run stays queued", async () => {
  let now = 0;
  let calls = 0;
  const settled = await pollAnalysisRun(
    {
      getAnalysisRun: async () => {
        calls += 1;
        return { ...completed, status: "queued" };
      },
    },
    "9",
    {
      intervalMs: 2_000,
      deadlineMs: 5_000,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    },
  );
  assert.equal(settled.kind, "deadline");
  assert.equal(deadlineMessage(), `${ANALYSIS_FAILURE_COPY.prefix}${ANALYSIS_FAILURE_COPY.timeout}`);
  assert.ok(calls >= 1);
});

test("poll stops on unmount and does not read after abort", async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = pollAnalysisRun(
    {
      getAnalysisRun: async () => {
        calls += 1;
        return { ...completed, status: "running" };
      },
    },
    "9",
    {
      signal: controller.signal,
      intervalMs: 1_000,
      deadlineMs: 60_000,
      now: () => 0,
      sleep: async (_ms, signal) => {
        controller.abort();
        if (signal?.aborted) return;
      },
    },
  );
  const settled = await pending;
  assert.equal(settled.kind, "aborted");
  assert.equal(calls, 1);
});

test("502, 504, and network errors keep polling and do not use the timeout sentence", async () => {
  const seen: string[] = [];
  const sleeps: number[] = [];
  let step = 0;
  const statuses: string[] = [];
  const settled = await pollAnalysisRun(
    {
      getAnalysisRun: async () => {
        step += 1;
        if (step === 1) throw new ApiError("Bad Gateway", 502);
        if (step === 2) throw new ApiError("Gateway Time-out", 504);
        if (step === 3) throw new TypeError("fetch failed");
        seen.push("completed");
        return completed;
      },
    },
    "9",
    {
      intervalMs: 2_000,
      random: () => 0.5,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      now: () => 0,
      deadlineMs: 60_000,
      onStatus: (status) => statuses.push(status),
    },
  );
  assert.equal(settled.kind, "completed");
  assert.deepEqual(seen, ["completed"]);
  assert.deepEqual(sleeps, [4_000, 8_000, 10_000]);
  assert.deepEqual(statuses, ["running", "running", "running"]);
  assert.equal(isTransientPollError(new ApiError("Bad Gateway", 502)), true);
  assert.equal(isTransientPollError(new ApiError("Gateway Time-out", 504)), true);
  assert.equal(isTransientPollError(new ApiError("Backend nicht erreichbar.", 0)), true);
  assert.equal(isTransientPollError(new ApiError("Die Analyse wurde nicht gefunden.", 404)), false);
});

test("a fetch abort that is not the poll signal is transient", async () => {
  let step = 0;
  const settled = await pollAnalysisRun(
    {
      getAnalysisRun: async () => {
        step += 1;
        if (step === 1) {
          const error = new Error("The operation was aborted.");
          error.name = "AbortError";
          throw error;
        }
        return completed;
      },
    },
    "9",
    { sleep: async () => {}, now: () => 0, deadlineMs: 60_000, random: () => 0.5 },
  );
  assert.equal(settled.kind, "completed");
  assert.equal(step, 2);
});

test("POLL_DEADLINE 180s during 502s is a timeout, not a GET error", async () => {
  let now = 0;
  let calls = 0;
  const settled = await pollAnalysisRun(
    {
      getAnalysisRun: async () => {
        calls += 1;
        throw new ApiError("Bad Gateway", 502);
      },
    },
    "9",
    {
      deadlineMs: POLL_DEADLINE_MS,
      now: () => now,
      random: () => 0.5,
      sleep: async () => {
        now = POLL_DEADLINE_MS;
      },
    },
  );
  assert.equal(settled.kind, "deadline");
  assert.equal(deadlineMessage(), analysisFailureMessage("timeout"));
  assert.equal(deadlineMessage().includes("502"), false);
  assert.ok(calls >= 1);
});

test("timeout copy comes from failureReason=timeout or the deadline, not from 504", async () => {
  const fromBackend = await pollAnalysisRun(
    {
      getAnalysisRun: async () =>
        ({ ...completed, status: "failed", failureReason: "timeout" }) as AnalysisRun,
    },
    "9",
    { sleep: async () => {}, now: () => 0 },
  );
  assert.equal(fromBackend.kind, "failed");
  if (fromBackend.kind === "failed") {
    assert.equal(fromBackend.message, analysisFailureMessage("timeout"));
  }

  const patternFailed = await pollAnalysisRun(
    {
      getAnalysisRun: async () =>
        ({ ...completed, status: "failed", failureReason: "pattern_failed" }) as AnalysisRun,
    },
    "9",
    { sleep: async () => {}, now: () => 0 },
  );
  assert.equal(patternFailed.kind, "failed");
  if (patternFailed.kind === "failed") {
    assert.equal(patternFailed.message.includes("zu lange gedauert"), false);
  }

  assert.equal(POLL_BACKOFF_MAX_MS, 10_000);
  assert.equal(pollDelayMs(0), 2_000);
  assert.equal(pollDelayMs(1, { random: () => 0.5 }), 4_000);
  assert.equal(pollDelayMs(2, { random: () => 0.5 }), 8_000);
  assert.equal(pollDelayMs(3, { random: () => 0.5 }), 10_000);
});

test("start stays locked while queued, running, starting, or another run is in flight", () => {
  assert.equal(analysisStartLocked({ runStatus: "queued" }), true);
  assert.equal(analysisStartLocked({ runStatus: "running" }), true);
  assert.equal(analysisStartLocked({ starting: true, runStatus: "idle" }), true);
  assert.equal(analysisStartLocked({ otherInFlight: true, runStatus: "idle" }), true);
  assert.equal(analysisStartLocked({ runStatus: "idle" }), false);
  assert.equal(analysisStartLocked({ runStatus: "failed" }), false);
});

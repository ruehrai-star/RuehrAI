import assert from "node:assert/strict";
import { test } from "node:test";
import type { AnalysisRun } from "@ruehrai/api-contracts";
import { ApiError } from "../api/types.ts";
import { ANALYSIS_FAILURE_COPY, analysisFailureMessage, clientDeadlineMessage } from "./failure.ts";
import {
  POLL_DEADLINE_MS,
  POLL_INTERVAL_MS,
  deadlineExceeded,
  deadlineMessage,
  interpretRun,
  pollAnalysisRun,
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
  const unknown = interpretRun({ status: "failed", failureReason: "brain_search_failed" });
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

<<<<<<< HEAD
test("poll stops on a failed run and surfaces failureReason", async () => {
  await assert.rejects(
    pollAnalysisRun(
      {
        getAnalysisRun: async () =>
          ({
            ...run,
            status: "failed",
            failureReason: "pattern_failed",
          }) as AnalysisRun,
      },
      "9",
      { attempts: 4, sleep: async () => {} },
    ),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.message, "pattern_failed");
      return true;
=======
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
>>>>>>> 3c65ff5 (Web: poll async Musteranalyse and bind Trefferliste by runId)
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

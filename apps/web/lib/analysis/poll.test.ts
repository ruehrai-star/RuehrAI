import assert from "node:assert/strict";
import { test } from "node:test";
import type { AnalysisRun } from "@ruehrai/api-contracts";
import { ApiError } from "../api/types.ts";
import { ANALYSIS_FAILURE_COPY } from "./failure.ts";
import {
  POLL_DEADLINE_MS,
  POLL_INITIAL_INTERVAL_MS,
  POLL_MAX_INTERVAL_MS,
  deadlineExceeded,
  interpretRun,
  nextPollInterval,
  pollAnalysisRun,
} from "./poll.ts";

const completed = { id: "9", status: "completed" } as AnalysisRun;

test("interval grows from 2s to 5s and then stays there", () => {
  assert.equal(POLL_INITIAL_INTERVAL_MS, 2_000);
  assert.equal(POLL_MAX_INTERVAL_MS, 5_000);
  assert.equal(POLL_DEADLINE_MS, 180_000);
  assert.equal(nextPollInterval(2_000), 3_000);
  assert.equal(nextPollInterval(3_000), 4_000);
  assert.equal(nextPollInterval(4_000), 5_000);
  assert.equal(nextPollInterval(5_000), 5_000);
  assert.equal(deadlineExceeded(179_999), false);
  assert.equal(deadlineExceeded(180_000), true);
});

test("interpretRun keeps queued and running in flight and maps failed reasons", () => {
  assert.deepEqual(interpretRun({ status: "queued" }), { kind: "in_flight", status: "queued" });
  assert.deepEqual(interpretRun({ status: "running" }), { kind: "in_flight", status: "running" });
  assert.deepEqual(interpretRun({ status: "completed" }), { kind: "completed" });
  const failed = interpretRun({ status: "failed", failureReason: "timeout" });
  assert.equal(failed.kind, "failed");
  if (failed.kind === "failed") {
    assert.equal(failed.message, `${ANALYSIS_FAILURE_COPY.prefix}${ANALYSIS_FAILURE_COPY.timeout}`);
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
  assert.deepEqual(sleeps, [2_000, 3_000]);
});

test("poll stops on a failed run with a mapped German reason", async () => {
  const settled = await pollAnalysisRun(
    {
      getAnalysisRun: async () =>
        ({
          ...completed,
          status: "failed",
          failureReason: "timed_out",
        }) as AnalysisRun,
    },
    "9",
    { sleep: async () => {}, now: () => 0 },
  );
  assert.equal(settled.kind, "failed");
  if (settled.kind === "failed") {
    assert.equal(settled.message, `${ANALYSIS_FAILURE_COPY.prefix}${ANALYSIS_FAILURE_COPY.timeout}`);
    assert.equal(settled.run?.id, "9");
  }
});

test("poll retries a missing run and then returns it", async () => {
  let attempt = 0;
  const settled = await pollAnalysisRun(
    {
      getAnalysisRun: async () => {
        attempt += 1;
        if (attempt < 3) throw new ApiError("Die Analyse wurde nicht gefunden.", 404);
        return completed;
      },
    },
    "9",
    { sleep: async () => {}, now: () => 0, deadlineMs: 60_000 },
  );
  assert.deepEqual(settled, { kind: "completed", run: completed });
  assert.equal(attempt, 3);
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

import assert from "node:assert/strict";
import { test } from "node:test";
import type { AnalysisRun } from "@ruehrai/api-contracts";
import { ApiError } from "../api/types.ts";
import { pollAnalysisRun } from "./poll.ts";

const run = { id: "9", status: "completed" } as AnalysisRun;

test("poll reads the run once when it is already completed", async () => {
  let calls = 0;
  const settled = await pollAnalysisRun(
    {
      getAnalysisRun: async (id) => {
        calls += 1;
        assert.equal(id, "9");
        return run;
      },
    },
    "9",
    { sleep: async () => {} },
  );
  assert.equal(settled, run);
  assert.equal(calls, 1);
});

test("poll retries a missing run and then returns it", async () => {
  const seen: string[] = [];
  let attempt = 0;
  const settled = await pollAnalysisRun(
    {
      getAnalysisRun: async (id) => {
        seen.push(id);
        attempt += 1;
        if (attempt < 3) throw new ApiError("Die Analyse wurde nicht gefunden.", 404);
        return run;
      },
    },
    "9",
    { attempts: 4, sleep: async () => {} },
  );
  assert.equal(settled.id, "9");
  assert.deepEqual(seen, ["9", "9", "9"]);
});

test("poll stops on errors other than a missing run", async () => {
  let calls = 0;
  await assert.rejects(
    pollAnalysisRun(
      {
        getAnalysisRun: async () => {
          calls += 1;
          throw new ApiError("Anmeldung erforderlich.", 401);
        },
      },
      "9",
      { attempts: 4, sleep: async () => {} },
    ),
    (error: unknown) => error instanceof ApiError && error.status === 401,
  );
  assert.equal(calls, 1);
});

test("poll surfaces the Backend 404 after the last attempt", async () => {
  await assert.rejects(
    pollAnalysisRun(
      {
        getAnalysisRun: async () => {
          throw new ApiError("Die Analyse wurde nicht gefunden.", 404);
        },
      },
      "9",
      { attempts: 2, sleep: async () => {} },
    ),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.message, "Die Analyse wurde nicht gefunden.");
      return true;
    },
  );
});

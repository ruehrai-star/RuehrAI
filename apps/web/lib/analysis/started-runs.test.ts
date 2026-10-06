import assert from "node:assert/strict";
import { test } from "node:test";
import { parseStartedRunMap } from "./started-runs.ts";

test("started-run map keeps only string geoKey to runId pairs", () => {
  assert.deepEqual(parseStartedRunMap(null), {});
  assert.deepEqual(parseStartedRunMap("{"), {});
  assert.deepEqual(parseStartedRunMap(JSON.stringify({ "ortsteil:osm:162894": "47", skip: 1 })), {
    "ortsteil:osm:162894": "47",
  });
});

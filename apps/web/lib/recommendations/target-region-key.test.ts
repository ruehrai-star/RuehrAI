import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isLegacyTargetRegionSet,
  itemMatchesMarkedRegion,
  itemTargetRegionKey,
  normalizeTargetRegionLabel,
  resolveTargetRegionKey,
  targetRegionKeyOf,
} from "./target-region-key.ts";

test("geoKey match uses the trimmed geoKey and wins over ags and label", () => {
  const marked = { geoKey: "  ortsteil:osm:162894  ", ags: "11000000", label: "Tempelhof" };
  assert.deepEqual(resolveTargetRegionKey(marked), { key: "ortsteil:osm:162894", source: "geoKey" });
  assert.equal(targetRegionKeyOf(marked), "ortsteil:osm:162894");
  assert.equal(
    itemMatchesMarkedRegion({ targetRegionGeoKey: "ortsteil:osm:162894" }, marked),
    true,
  );
  assert.equal(itemMatchesMarkedRegion({ targetRegionGeoKey: "ags:11000000" }, marked), false);
  assert.equal(itemMatchesMarkedRegion({ targetRegionGeoKey: "label:tempelhof" }, marked), false);
});

test("ags fallback is ags:{ags} when geoKey is missing or empty", () => {
  const marked = { geoKey: "", ags: " 11000000 ", label: "Berlin" };
  assert.deepEqual(resolveTargetRegionKey(marked), { key: "ags:11000000", source: "ags" });
  assert.equal(
    itemMatchesMarkedRegion({ targetRegionGeoKey: "ags:11000000" }, marked),
    true,
  );
  assert.equal(itemMatchesMarkedRegion({ targetRegionGeoKey: "11000000" }, marked), false);
  assert.equal(itemMatchesMarkedRegion({ targetRegionGeoKey: "label:berlin" }, marked), false);
  assert.equal(resolveTargetRegionKey({ geoKey: null, ags: null, label: "Berlin" }).source, "label");
});

test("label fallback is label:{normalized} when geoKey and ags are missing", () => {
  const marked = { geoKey: "  ", ags: null, label: "  Tempelhof  Schöneberg  " };
  assert.equal(normalizeTargetRegionLabel("  Tempelhof  Schöneberg  "), "tempelhof schöneberg");
  assert.deepEqual(resolveTargetRegionKey(marked), {
    key: "label:tempelhof schöneberg",
    source: "label",
  });
  assert.equal(
    itemMatchesMarkedRegion({ targetRegionGeoKey: "label:tempelhof schöneberg" }, marked),
    true,
  );
  assert.equal(itemMatchesMarkedRegion({ targetRegionGeoKey: "Tempelhof" }, marked), false);
});

test("old set: every item missing or empty targetRegionGeoKey is legacy", () => {
  const oldItems = [
    { targetRegionGeoKey: undefined },
    { targetRegionGeoKey: "" },
    { targetRegionGeoKey: "   " },
  ];
  assert.equal(isLegacyTargetRegionSet(oldItems), true);
  assert.equal(itemTargetRegionKey({ targetRegionGeoKey: "" }), null);
  assert.equal(itemMatchesMarkedRegion({ targetRegionGeoKey: "" }, { geoKey: "ortsteil:osm:162894" }), false);
  assert.equal(isLegacyTargetRegionSet([]), false);
});

test("mixed set: only the matching targetRegionGeoKey is kept; empty keys are not legacy of the whole set", () => {
  const mixed = [
    { targetRegionGeoKey: "ortsteil:osm:162894" },
    { targetRegionGeoKey: "bezirk:osm:2613798" },
    { targetRegionGeoKey: "" },
  ];
  const marked = { geoKey: "ortsteil:osm:162894", ags: null, label: "Tempelhof" };
  assert.equal(isLegacyTargetRegionSet(mixed), false);
  assert.equal(itemMatchesMarkedRegion(mixed[0]!, marked), true);
  assert.equal(itemMatchesMarkedRegion(mixed[1]!, marked), false);
  assert.equal(itemMatchesMarkedRegion(mixed[2]!, marked), false);
  assert.deepEqual(
    mixed.filter((item) => itemMatchesMarkedRegion(item, marked)).map((item) => item.targetRegionGeoKey),
    ["ortsteil:osm:162894"],
  );
});

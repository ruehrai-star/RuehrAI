import assert from "node:assert/strict";
import { test } from "node:test";
import { persistedMarkedKey, withMarkedRegionHref } from "./marked-region.ts";
import { regionListKey } from "./regions.ts";
import type { TargetRegion } from "../api/types.ts";

function region(partial: Pick<TargetRegion, "label" | "geoKey">): TargetRegion {
  return {
    grain: null,
    lon: null,
    lat: null,
    bounds: null,
    geometry: null,
    updatedAt: "2026-10-06T12:00:00.000Z",
    ...partial,
  };
}

const tempelhof = region({ label: "Tempelhof", geoKey: "ortsteil:osm:162894" });
const innenstadt = region({ label: "Innenstadt", geoKey: "stadtbezirk:koeln:innenstadt" });

test("persisted mark survives a list reload and does not fall back to the first row", () => {
  const items = [innenstadt, tempelhof];
  assert.equal(persistedMarkedKey(items, regionListKey(tempelhof)), regionListKey(tempelhof));
  assert.equal(persistedMarkedKey(items, null), regionListKey(innenstadt));
  assert.equal(persistedMarkedKey([], "ortsteil:osm:162894"), null);
});

test("nav hrefs carry the marked catalog key", () => {
  assert.equal(withMarkedRegionHref("/empfehlungen", "ortsteil:osm:162894"), "/empfehlungen?region=ortsteil%3Aosm%3A162894");
  assert.equal(withMarkedRegionHref("/verlauf#zielregion", "ortsteil:osm:162894"), "/verlauf?region=ortsteil%3Aosm%3A162894#zielregion");
  assert.equal(withMarkedRegionHref("/karte", null), "/karte");
});

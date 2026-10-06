import assert from "node:assert/strict";
import { test } from "node:test";
import type { TargetRegion } from "../api/types.ts";
import {
  formatRunRegionLabel,
  regionsFromRunInput,
  runRegionEntries,
  runRegionEntryLabel,
} from "./run-label.ts";

function region(partial: Pick<TargetRegion, "label" | "geoKey"> & Partial<TargetRegion>): TargetRegion {
  return {
    grain: "other",
    lon: null,
    lat: null,
    bounds: null,
    geometry: null,
    updatedAt: "2026-10-06T08:00:00.000Z",
    ...partial,
  };
}

const six: TargetRegion[] = [
  region({ label: "Innenstadt", geoKey: "stadtbezirk:koeln:innenstadt", level: "bezirk", parentLabel: "Köln" }),
  region({ label: "Rodenkirchen", geoKey: "stadtbezirk:koeln:rodenkirchen", level: "bezirk", parentLabel: "Köln" }),
  region({ label: "Lindenthal", geoKey: "stadtbezirk:koeln:lindenthal", level: "bezirk", parentLabel: "Köln" }),
  region({ label: "Ehrenfeld", geoKey: "stadtbezirk:koeln:ehrenfeld", level: "bezirk", parentLabel: "Köln" }),
  region({ label: "Nippes", geoKey: "stadtbezirk:koeln:nippes", level: "bezirk", parentLabel: "Köln" }),
  region({ label: "Chorweiler", geoKey: "stadtbezirk:koeln:chorweiler", level: "bezirk", parentLabel: "Köln" }),
];

test("one region is Name (Gemeinde) or the name alone, never a key", () => {
  assert.equal(runRegionEntryLabel(six[0]), "Innenstadt (Köln)");
  assert.equal(runRegionEntryLabel(region({ label: "München", geoKey: "09162000", level: "gemeinde" })), "München");
  assert.equal(runRegionEntryLabel(region({ label: "ags:05315000", geoKey: "ags:05315000" })), "");
  assert.equal(runRegionEntryLabel(six[0])?.includes("stadtbezirk"), false);
});

test("six Zielregionen collapse to first + 5 weitere and expand to every Name (Gemeinde)", () => {
  const view = formatRunRegionLabel(six);
  assert.equal(view.summary, "Innenstadt (Köln) + 5 weitere");
  assert.equal(view.expandable, true);
  assert.deepEqual(view.entries, [
    "Innenstadt (Köln)",
    "Rodenkirchen (Köln)",
    "Lindenthal (Köln)",
    "Ehrenfeld (Köln)",
    "Nippes (Köln)",
    "Chorweiler (Köln)",
  ]);
  assert.equal(runRegionEntries(six).join(" ").includes("stadtbezirk"), false);
  assert.equal(view.entries.length, 6);
});

test("the run snapshot uses input.regions, not only the first region", () => {
  const fromInput = regionsFromRunInput({ region: six[0]!, regions: six });
  assert.equal(fromInput.length, 6);
  assert.equal(formatRunRegionLabel(fromInput).summary, "Innenstadt (Köln) + 5 weitere");
  const onlyFirst = regionsFromRunInput({ region: six[0]! });
  assert.equal(onlyFirst.length, 1);
  assert.equal(formatRunRegionLabel(onlyFirst).summary, "Innenstadt (Köln)");
  assert.equal(formatRunRegionLabel(onlyFirst).expandable, false);
});

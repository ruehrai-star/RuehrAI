import assert from "node:assert/strict";
import { test } from "node:test";
import type { SearchHit, TargetRegion } from "../api/types.ts";
import { catalogHitVisibleText, catalogParentName, catalogPlaceName, isCatalogKey, visibleSavedRegions } from "../format.ts";
import { MISSING_AREA_LABEL, buildKarte, readRegionGeometry } from "../map/karte.ts";
import { recommendationEmptyCopy, recommendationSubtitle } from "../recommendations/model.ts";
import {
  REGION_LIST_COPY,
  addRegionToFront,
  ensureMarkedKey,
  isHitInList,
  markedRegion,
  nextMarkedKeyAfterAdd,
  nextMarkedKeyAfterRemove,
  regionListKey,
  removeRegion,
} from "./regions.ts";

function region(partial: Partial<TargetRegion> & Pick<TargetRegion, "label">): TargetRegion {
  return {
    grain: null,
    geoKey: null,
    lon: null,
    lat: null,
    bounds: null,
    geometry: null,
    updatedAt: "2026-10-03T12:00:00.000Z",
    ...partial,
  };
}

function hit(partial: Partial<SearchHit> & Pick<SearchHit, "id" | "label">): SearchHit {
  return {
    grain: "ags",
    geoKey: null,
    lon: null,
    lat: null,
    ...partial,
  };
}

test("empty list copy stays exact", () => {
  assert.equal(REGION_LIST_COPY.heading, "Zielregionen");
  assert.equal(REGION_LIST_COPY.empty, "Noch keine Zielregionen.");
  assert.equal(REGION_LIST_COPY.searchPlaceholder, "Zielregion suchen");
  assert.equal(REGION_LIST_COPY.noHits, "Keine passende Zielregion.");
  assert.equal(REGION_LIST_COPY.added, "Hinzugefügt");
  assert.equal(REGION_LIST_COPY.missingArea, MISSING_AREA_LABEL);
});

test("a hit already in the list is Hinzugefügt and cannot be added again", () => {
  const items = [region({ label: "Lankwitz", geoKey: "ortsteil:osm:5712247", level: "ortsteil", parentLabel: "Berlin" })];
  const already = hit({
    id: "ortsteil:osm:5712247",
    label: "Lankwitz",
    grain: "other",
    geoKey: "ortsteil:osm:5712247",
  });
  const fresh = hit({ id: "ags:09162000", label: "München", geoKey: "09162000" });
  assert.equal(isHitInList(already, items), true);
  assert.equal(isHitInList(fresh, items), false);
  const again = addRegionToFront(items, items[0] as TargetRegion);
  assert.equal(again.length, 1);
  assert.equal(regionListKey(again[0] as TargetRegion), "ortsteil:osm:5712247");
});

test("add goes to the front and keeps an existing mark", () => {
  const munich = region({ label: "München", geoKey: "09162000", grain: "ags" });
  const lankwitz = region({ label: "Lankwitz", geoKey: "ortsteil:osm:5712247", level: "ortsteil" });
  const marked = regionListKey(munich);
  const next = addRegionToFront([munich], lankwitz);
  assert.deepEqual(
    next.map((item) => item.label),
    ["Lankwitz", "München"],
  );
  assert.equal(nextMarkedKeyAfterAdd([munich], lankwitz, marked), marked);
  assert.equal(nextMarkedKeyAfterAdd([], lankwitz, null), regionListKey(lankwitz));
});

test("remove moves the mark to the row below, otherwise the row above", () => {
  const first = region({ label: "Lankwitz", geoKey: "ortsteil:osm:5712247" });
  const middle = region({ label: "Plagwitz", geoKey: "ortsteil:osm:9" });
  const last = region({ label: "München", geoKey: "09162000" });
  const items = [first, middle, last];

  assert.equal(nextMarkedKeyAfterRemove(items, regionListKey(first), regionListKey(first)), regionListKey(middle));
  assert.equal(nextMarkedKeyAfterRemove(items, regionListKey(middle), regionListKey(middle)), regionListKey(last));
  assert.equal(nextMarkedKeyAfterRemove(items, regionListKey(last), regionListKey(last)), regionListKey(middle));
  assert.equal(nextMarkedKeyAfterRemove(items, regionListKey(middle), regionListKey(first)), regionListKey(first));
  assert.equal(nextMarkedKeyAfterRemove([first], regionListKey(first), regionListKey(first)), null);
  assert.deepEqual(
    removeRegion(items, regionListKey(middle)).map((item) => item.label),
    ["Lankwitz", "München"],
  );
});

test("catalog keys stay on the row for save and are not rendered", () => {
  const saved = region({
    label: "Lankwitz",
    geoKey: "ortsteil:osm:5712247",
    level: "ortsteil",
    parentLabel: "Berlin",
  });
  const keyOnly = region({
    label: "ortsteil:osm:5712247",
    geoKey: "ortsteil:osm:5712247",
    level: "ortsteil",
    parentLabel: "Berlin",
  });
  const text = catalogHitVisibleText(saved);
  assert.equal(regionListKey(saved), "ortsteil:osm:5712247");
  assert.equal(isCatalogKey(regionListKey(saved)), true);
  assert.equal(text.includes("ortsteil:osm:5712247"), false);
  assert.equal(text.includes("plz5:"), false);
  assert.equal(text.includes("ags:"), false);
  assert.equal(catalogPlaceName(keyOnly), null);
  assert.equal(catalogHitVisibleText(keyOnly), "");
  assert.deepEqual(visibleSavedRegions([saved, keyOnly]).map((item) => item.label), ["Lankwitz"]);
  assert.deepEqual(addRegionToFront([saved], keyOnly).map((item) => item.label), ["Lankwitz"]);
});

test("an old München row without level or parentLabel shows the name only", () => {
  const munich = region({ label: "München", geoKey: "09162000" });
  assert.equal(catalogPlaceName(munich), "München");
  assert.equal(catalogParentName(munich), null);
  assert.equal(catalogHitVisibleText(munich), "München");
  assert.equal(munich.level ?? null, null);
  assert.equal(munich.parentLabel ?? null, null);
});

test("bounds do not become a rectangle and do not frame the camera", () => {
  const boundsOnly = region({
    label: "München",
    geoKey: "09162000",
    bounds: { west: 11, south: 48, east: 12, north: 49 },
    geometry: null,
  });
  const model = buildKarte({
    stores: [],
    regions: [boundsOnly],
    markedKey: regionListKey(boundsOnly),
    recommendations: [],
    addressesKnownEmpty: true,
  });
  assert.equal(readRegionGeometry(boundsOnly.geometry), null);
  assert.equal(model.region.features.length, 0);
  assert.equal(model.showLegend, false);
  assert.equal(model.camera.kind, "germany");
  assert.equal(JSON.stringify(model.region).includes("Polygon"), false);
});

test("Top-3 sentences follow the list length", () => {
  assert.equal(recommendationSubtitle(0), null);
  assert.equal(recommendationEmptyCopy(0), null);
  assert.equal(recommendationSubtitle(1), "Top 3 in Ihrer Zielregion");
  assert.equal(recommendationEmptyCopy(1), "Keine passenden Standorte in der Zielregion.");
  assert.equal(recommendationSubtitle(2), "Top 3 in Ihrer Zielregion");
  assert.equal(recommendationEmptyCopy(2), "Keine passenden Standorte in der Zielregion.");
  assert.equal(recommendationSubtitle(3), "Top 3 in Ihrer Zielregion");
  assert.equal(recommendationEmptyCopy(3), "Keine passenden Standorte in der Zielregion.");
});

test("a non-empty list always has exactly one marked row", () => {
  const items = [region({ label: "München", geoKey: "09162000" }), region({ label: "Berlin", geoKey: "11000000" })];
  assert.equal(ensureMarkedKey([], null), null);
  assert.equal(ensureMarkedKey(items, null), "09162000");
  assert.equal(ensureMarkedKey(items, "11000000"), "11000000");
  assert.equal(markedRegion([], null), null);
  assert.equal(markedRegion(items, "11000000")?.label, "Berlin");
  assert.equal(markedRegion(items, null)?.label, "München");
});

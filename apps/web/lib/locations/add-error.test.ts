import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ApiError, NetworkError } from "../api/types.ts";
import {
  addTargetRegionUserMessage,
  isMissingMapAreaFailure,
  missingMapAreaClientError,
  sourceLacksMapArea,
} from "./add-error.ts";
import { REGION_LIST_COPY } from "./regions.ts";

const ENGLISH_NO_AREA =
  "Region has no map area in the catalog. Supply geometry or bounds, or choose a place whose polygon is in the catalog.";

test("4xx no-map-area copy is German and never the Backend English", () => {
  const fromHttp = addTargetRegionUserMessage(new ApiError(ENGLISH_NO_AREA, 400));
  assert.equal(fromHttp, "Für diese Region liegt noch keine Fläche vor. Bitte wählen Sie eine andere.");
  assert.equal(fromHttp, REGION_LIST_COPY.noMapArea);
  assert.equal(fromHttp.includes("map area"), false);
  assert.equal(fromHttp.includes("catalog"), false);
  assert.equal(fromHttp.includes("geometry"), false);
  assert.equal(isMissingMapAreaFailure(new ApiError(ENGLISH_NO_AREA, 422)), true);
  const fromClient = addTargetRegionUserMessage(missingMapAreaClientError());
  assert.equal(fromClient, REGION_LIST_COPY.noMapArea);
  assert.equal(sourceLacksMapArea({ geometry: null, bounds: null }), true);
  assert.equal(sourceLacksMapArea({ id: "ags:09162000", label: "München", grain: "ags" }), false);
});

test("other 4xx add failures stay a German generic and drop Backend English", () => {
  const placeRequired = addTargetRegionUserMessage(
    new ApiError("Name the catalog place with geoKey, ags, or plz. A free-text label is not enough to add or remove an item.", 400),
  );
  assert.equal(placeRequired, REGION_LIST_COPY.addFailed);
  assert.equal(placeRequired.includes("geoKey"), false);
  assert.equal(placeRequired.includes("catalog"), false);
  assert.equal(addTargetRegionUserMessage(new ApiError("Bad Request", 400)), REGION_LIST_COPY.addFailed);
  assert.equal(addTargetRegionUserMessage(new ApiError(ENGLISH_NO_AREA, 500)), REGION_LIST_COPY.addFailed);
  assert.match(addTargetRegionUserMessage(new NetworkError("Backend nicht erreichbar (http://x).")), /Backend nicht erreichbar/);
});

test("Zielregion add UI shows the German inline alert and never window.alert or English catalog copy", () => {
  const section = readFileSync(new URL("../../components/region-section.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../../components/standorte-page.tsx", import.meta.url), "utf8");
  assert.equal(section.includes("alert("), false);
  assert.equal(page.includes("alert("), false);
  assert.equal(section.includes("window.alert"), false);
  assert.match(section, /sourceLacksMapArea/);
  assert.match(section, /addTargetRegionUserMessage/);
  assert.match(section, /missingMapAreaClientError/);
  assert.match(section, /pickerError/);
  assert.match(section, /role="alert"/);
  assert.match(section, /aria-live="assertive"/);
  assert.equal(section.includes("Region has no map area"), false);
  assert.equal(page.includes("Region has no map area"), false);
  assert.equal(section.includes("errorText("), false);
});

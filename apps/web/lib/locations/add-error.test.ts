import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ErrorResponse } from "@ruehrai/api-contracts";
import { ApiError, NetworkError } from "../api/types.ts";
import { ANALYSIS_FAILURE_COPY } from "../analysis/failure.ts";
import { LOGIN_EXPIRED_COPY } from "../session-storage.ts";
import { USER_MESSAGE_COPY } from "../user-message.ts";
import {
  TARGET_REGION_WITHOUT_GEOMETRY_CODE,
  addTargetRegionUserMessage,
  isMissingMapAreaFailure,
  isPlaceRequiredFailure,
  missingMapAreaClientError,
  sourceLacksMapArea,
} from "./add-error.ts";
import { REGION_LIST_COPY } from "./regions.ts";

const ENGLISH_NO_AREA =
  "Region has no map area in the catalog. Supply geometry or bounds, or choose a place whose polygon is in the catalog.";
const ENGLISH_PLACE_REQUIRED =
  "Name the catalog place with geoKey, ags, or plz. A free-text label is not enough to add or remove an item.";

function alertDom(text: string): string {
  return renderToStaticMarkup(
    createElement("p", { className: "message message-error", role: "alert" }, text),
  );
}

test("OpenAPI 0.19.6 ErrorResponse.code documents TARGET_REGION_WITHOUT_GEOMETRY", () => {
  const yaml = readFileSync(new URL("../../../../packages/api-contracts/openapi/openapi.yaml", import.meta.url), "utf8");
  assert.match(yaml, /TARGET_REGION_WITHOUT_GEOMETRY/);
  assert.equal(TARGET_REGION_WITHOUT_GEOMETRY_CODE, "TARGET_REGION_WITHOUT_GEOMETRY");
  const sample: ErrorResponse = {
    statusCode: 400,
    message: ENGLISH_NO_AREA,
    error: "Bad Request",
    code: TARGET_REGION_WITHOUT_GEOMETRY_CODE,
  };
  assert.equal(sample.code, TARGET_REGION_WITHOUT_GEOMETRY_CODE);
});

test("400 with code TARGET_REGION_WITHOUT_GEOMETRY shows German area copy and never the English message", () => {
  const error = new ApiError(ENGLISH_NO_AREA, 400, TARGET_REGION_WITHOUT_GEOMETRY_CODE);
  const fromHttp = addTargetRegionUserMessage(error);
  assert.equal(fromHttp, REGION_LIST_COPY.noMapArea);
  assert.equal(REGION_LIST_COPY.noMapArea, USER_MESSAGE_COPY.noMapArea);
  assert.equal(fromHttp, "Für diese Region liegt noch keine Fläche vor. Bitte wählen Sie eine andere.");
  assert.equal(fromHttp.includes(ENGLISH_NO_AREA), false);
  assert.equal(fromHttp.includes("map area"), false);
  assert.equal(fromHttp.includes("catalog"), false);
  assert.equal(fromHttp.includes("geometry"), false);
  assert.equal(isMissingMapAreaFailure(error), true);
  const unrelatedBody = addTargetRegionUserMessage(
    new ApiError("any English body", 400, TARGET_REGION_WITHOUT_GEOMETRY_CODE),
  );
  assert.equal(unrelatedBody, REGION_LIST_COPY.noMapArea);
  assert.equal(unrelatedBody.includes("any English body"), false);
  const fromClient = addTargetRegionUserMessage(missingMapAreaClientError());
  assert.equal(fromClient, REGION_LIST_COPY.noMapArea);
  assert.equal(sourceLacksMapArea({ geometry: null, bounds: null }), true);
  assert.equal(sourceLacksMapArea({ id: "ags:09162000", label: "München", grain: "ags" }), false);
  const dom = alertDom(fromHttp);
  assert.equal(dom.includes(ENGLISH_NO_AREA), false);
  assert.equal(dom.includes(REGION_LIST_COPY.noMapArea), true);
});

test("400 without the published code does not use English no-map-area matching", () => {
  const fromHttp = addTargetRegionUserMessage(new ApiError(ENGLISH_NO_AREA, 400));
  assert.equal(fromHttp, USER_MESSAGE_COPY.invalidInput);
  assert.equal(fromHttp.includes("map area"), false);
  assert.equal(isMissingMapAreaFailure(new ApiError(ENGLISH_NO_AREA, 400)), false);
  assert.equal(isMissingMapAreaFailure(new ApiError(ENGLISH_NO_AREA, 422, TARGET_REGION_WITHOUT_GEOMETRY_CODE)), false);
  assert.equal(isMissingMapAreaFailure(new ApiError(ENGLISH_NO_AREA, 500, TARGET_REGION_WITHOUT_GEOMETRY_CODE)), false);
});

test("POST /target-region 400 place-required is German and never geoKey or Backend English", () => {
  const fromHttp = addTargetRegionUserMessage(new ApiError(ENGLISH_PLACE_REQUIRED, 400));
  assert.equal(fromHttp, REGION_LIST_COPY.placeRequired);
  assert.equal(fromHttp, "Bitte wählen Sie die Zielregion über die Suche. Ein Name allein reicht nicht.");
  assert.equal(fromHttp.includes("geoKey"), false);
  assert.equal(fromHttp.includes("catalog"), false);
  assert.equal(isPlaceRequiredFailure(new ApiError(ENGLISH_PLACE_REQUIRED, 400)), true);
  assert.equal(isPlaceRequiredFailure(new ApiError(ENGLISH_PLACE_REQUIRED, 400, "other_code")), false);
  const dom = alertDom(fromHttp);
  assert.equal(dom.includes(ENGLISH_PLACE_REQUIRED), false);
  assert.equal(dom.includes(REGION_LIST_COPY.placeRequired), true);
});

test("other POST /target-region 4xx stay German status copy and never Backend English", () => {
  const validation = addTargetRegionUserMessage(
    new ApiError("label must be shorter than or equal to 200 characters", 400),
  );
  assert.equal(validation, USER_MESSAGE_COPY.invalidInput);
  assert.equal(validation.includes("label must"), false);
  assert.equal(validation.includes("200 characters"), false);
  assert.equal(validation.includes(ANALYSIS_FAILURE_COPY.tooManyTargetRegions), false);
  assert.equal(addTargetRegionUserMessage(new ApiError("Unauthorized", 401)), LOGIN_EXPIRED_COPY);
  assert.equal(
    addTargetRegionUserMessage(new NetworkError("Backend nicht erreichbar (http://x).")),
    USER_MESSAGE_COPY.network,
  );
  assert.equal(addTargetRegionUserMessage(new ApiError("Boom", 500)), USER_MESSAGE_COPY.serverUnavailable);
  assert.equal(alertDom(validation).includes("must be shorter"), false);
});

test("add does not invent a 200-item cap or a 409 duplicate; those are not POST /target-region 4xx", () => {
  assert.equal(REGION_LIST_COPY.addFailed, "Zielregion konnte nicht gespeichert werden.");
  assert.equal(ANALYSIS_FAILURE_COPY.tooManyTargetRegions, "Bitte wählen Sie höchstens 200 Zielregionen.");
  const addCap = addTargetRegionUserMessage(new ApiError("Too many target regions: maximum is 200", 400));
  assert.equal(addCap, USER_MESSAGE_COPY.invalidInput);
  assert.equal(addCap.includes("200 Zielregionen"), false);
  const conflict = addTargetRegionUserMessage(new ApiError("already exists", 409));
  assert.equal(conflict, USER_MESSAGE_COPY.conflict);
  assert.equal(conflict.includes("bereits markiert"), false);
  assert.equal(conflict.includes("already exists"), false);
});

test("Standorte add uses the dedicated mapper and never interpolates error.message", () => {
  const page = readFileSync(new URL("../../components/standorte-page.tsx", import.meta.url), "utf8");
  const section = readFileSync(new URL("../../components/region-section.tsx", import.meta.url), "utf8");
  const mapper = readFileSync(new URL("./add-error.ts", import.meta.url), "utf8");
  assert.match(page, /addTargetRegionUserMessage/);
  assert.match(page, /\{regionError\}|error=\{regionError\}/);
  assert.equal(page.includes("error.message"), false);
  assert.equal(section.includes("alert("), false);
  assert.equal(page.includes("alert("), false);
  assert.equal(section.includes("window.alert"), false);
  assert.match(section, /sourceLacksMapArea/);
  assert.match(section, /addTargetRegionUserMessage/);
  assert.match(section, /missingMapAreaClientError/);
  assert.match(section, /pickerError/);
  assert.match(section, /role="alert"/);
  assert.equal(section.includes("Region has no map area"), false);
  assert.equal(page.includes("Region has no map area"), false);
  assert.equal(mapper.includes("TODO(0.19.6)"), false);
  assert.equal(mapper.includes("no map area"), false);
  assert.match(mapper, /matchesPublishedMissingMapAreaCode/);
  assert.match(mapper, /TARGET_REGION_WITHOUT_GEOMETRY/);
});

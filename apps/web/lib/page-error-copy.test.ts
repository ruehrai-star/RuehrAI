import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ADDRESS_COPY } from "./addresses/model.ts";
import { ANALYSIS_FAILURE_COPY, analysisFailureFromHttp } from "./analysis/failure.ts";
import { ApiError, NetworkError } from "./api/types.ts";
import { LOGIN_EXPIRED_COPY } from "./session-storage.ts";
import {
  MARKED_TARGET_REGION_NOT_FOUND_CODE,
  USER_MESSAGE_COPY,
  authErrorMessage,
  errorText,
} from "./user-message.ts";

const ENGLISH = "Internal Server Error: relation \"app.users\" does not exist";

function pageSource(relativeFromComponents: string): string {
  return readFileSync(new URL(`../components/${relativeFromComponents}`, import.meta.url), "utf8");
}

function alertDom(text: string): string {
  return renderToStaticMarkup(
    createElement("p", { className: "message message-error", role: "alert" }, text),
  );
}

function assertGermanAlert(dom: string, german: string, english: string): void {
  assert.equal(dom.includes(english), false, `English backend message leaked in DOM: ${dom}`);
  assert.equal(dom.includes(german), true, `Expected German copy in DOM: ${dom}`);
}

test("Login: English backend message is not in the DOM; German login copy is", () => {
  const english = "Invalid email or password";
  const text = authErrorMessage(new ApiError(english, 401), "login");
  const fallback = authErrorMessage(new ApiError(ENGLISH, 503), "login");
  assertGermanAlert(alertDom(text), "E-Mail oder Passwort ist ungültig.", english);
  assertGermanAlert(alertDom(fallback), "Anmeldung fehlgeschlagen.", ENGLISH);
  const source = pageSource("login-form.tsx");
  assert.match(source, /authErrorMessage\(caught, "login"\)/);
  assert.match(source, /role="alert"/);
  assert.equal(source.includes("error.message"), false);
  assert.equal(source.includes(LOGIN_EXPIRED_COPY) || source.includes("LOGIN_EXPIRED_COPY"), true);
});

test("Registrierung: English backend message is not in the DOM; German register copy is", () => {
  const english = "Email already registered";
  const text = authErrorMessage(new ApiError(english, 409), "register");
  const fallback = authErrorMessage(new ApiError(ENGLISH, 418), "register");
  assertGermanAlert(alertDom(text), "Diese E-Mail ist bereits registriert.", english);
  assertGermanAlert(alertDom(fallback), "Registrierung fehlgeschlagen.", ENGLISH);
  const source = pageSource("register-form.tsx");
  assert.match(source, /authErrorMessage\(caught, "register"\)/);
  assert.match(source, /role="alert"/);
  assert.equal(source.includes("error.message"), false);
});

test("Standorte: English backend message is not in the DOM; German load copy is", () => {
  const fallback = "Standorte konnten nicht geladen werden.";
  const text = errorText(new ApiError("Store not found", 404), fallback);
  assertGermanAlert(alertDom(text), USER_MESSAGE_COPY.notFound, "Store not found");
  const unknown = errorText(new ApiError(ENGLISH, 500, "weird_code"), fallback);
  assertGermanAlert(alertDom(unknown), fallback, ENGLISH);
  const source = pageSource("standorte-page.tsx");
  assert.match(source, /errorText\(/);
  assert.match(source, /\{loadError\}/);
  assert.equal(source.includes("error.message"), false);
});

test("Karte: English backend message is not in the DOM; German layer and search copy is", () => {
  const layer = errorText(new ApiError("Layer not found", 404), "Layer konnte nicht geladen werden.");
  const search = errorText(new ApiError("Search failed", 502), "Suche fehlgeschlagen.");
  const stores = errorText(
    new NetworkError("Backend nicht erreichbar (http://backend.test)."),
    "Filialadressen konnten nicht geladen werden.",
  );
  assertGermanAlert(alertDom(layer), USER_MESSAGE_COPY.notFound, "Layer not found");
  assertGermanAlert(alertDom(search), USER_MESSAGE_COPY.serverUnavailable, "Search failed");
  assertGermanAlert(alertDom(stores), USER_MESSAGE_COPY.network, "Backend nicht erreichbar (http://backend.test).");
  const source = pageSource("map-page.tsx");
  assert.match(source, /errorText\(error, "Layer konnte nicht geladen werden\."\)/);
  assert.match(source, /errorText\(error, "Suche fehlgeschlagen\."\)/);
  assert.equal(source.includes("error.message"), false);
});

test("Empfehlungen: English backend message is not in the DOM; German analysis copy is", () => {
  const load = errorText(new ApiError("Recommendations not found", 404), "Empfehlungen konnten nicht geladen werden.");
  const run = analysisFailureFromHttp(500, ENGLISH);
  const marked = analysisFailureFromHttp(404, "Marked target region not found", MARKED_TARGET_REGION_NOT_FOUND_CODE);
  assertGermanAlert(alertDom(load), USER_MESSAGE_COPY.notFound, "Recommendations not found");
  assertGermanAlert(alertDom(run), ANALYSIS_FAILURE_COPY.unexpected, ENGLISH);
  assertGermanAlert(alertDom(marked), USER_MESSAGE_COPY.markedTargetRegionMissing, "Marked target region not found");
  const source = pageSource("empfehlungen-page.tsx");
  assert.match(source, /errorText\(/);
  assert.match(source, /analysisFailureFromHttp\(status, message, code\)/);
  assert.match(source, /\{loadError\}/);
  assert.equal(source.includes("error.message"), false);
});

test("Musteranalyse: English backend message is not in the DOM; German analysis copy is", () => {
  const input = errorText(new ApiError("Bad Request", 400), "Die Eingaben konnten nicht geladen werden.");
  const action = analysisFailureFromHttp(502, "Bad Gateway");
  assertGermanAlert(alertDom(input), USER_MESSAGE_COPY.invalidInput, "Bad Request");
  assertGermanAlert(alertDom(action), ANALYSIS_FAILURE_COPY.unexpected, "Bad Gateway");
  const source = pageSource("musteranalyse-page.tsx");
  assert.match(source, /errorText\(/);
  assert.match(source, /analysisFailureFromHttp\(status, message, code\)/);
  assert.equal(source.includes("error.message"), false);
});

test("Verlauf: English backend message is not in the DOM; German load copy is", () => {
  const fallback = "Der Verlauf konnte nicht geladen werden.";
  const text = errorText(new ApiError("Forbidden", 403), fallback);
  assertGermanAlert(alertDom(text), USER_MESSAGE_COPY.forbidden, "Forbidden");
  const source = pageSource("verlauf-page.tsx");
  assert.match(source, /errorText\(/);
  assert.match(source, /\{loadError\}/);
  assert.equal(source.includes("error.message"), false);
});

test("Adressen: English backend message is not in the DOM; German failed copy is", () => {
  assertGermanAlert(alertDom(ADDRESS_COPY.failed), "Auswertung fehlgeschlagen.", ENGLISH);
  const source = pageSource("adressen-page.tsx");
  assert.match(source, /view\.failedText/);
  assert.equal(source.includes("error.message"), false);
  assert.equal(source.includes("errorText"), false);
});

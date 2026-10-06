import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, NetworkError } from "./api/types.ts";
import { LOGIN_EXPIRED_COPY } from "./session-storage.ts";
import {
  MARKED_TARGET_REGION_NOT_FOUND_CODE,
  USER_MESSAGE_COPY,
  authErrorMessage,
  errorText,
} from "./user-message.ts";

const ENGLISH = "Layer not found — please retry later.";

test("auth errors use the UX-gate wording and never the backend message", () => {
  assert.equal(
    authErrorMessage(new ApiError("Invalid email or password", 401), "login"),
    "E-Mail oder Passwort ist ungültig.",
  );
  assert.equal(
    authErrorMessage(new ApiError("Email already registered", 409), "register"),
    "Diese E-Mail ist bereits registriert.",
  );
  assert.equal(authErrorMessage(new ApiError("bad", 400), "register"), "Die Angaben sind ungültig.");
  assert.equal(authErrorMessage(new ApiError("Unprocessable", 422), "register"), "Die Angaben sind ungültig.");
  assert.equal(
    authErrorMessage(new ApiError("Bad Gateway", 502), "login"),
    "Die Antwort des Backends ist ungültig.",
  );
  assert.equal(
    authErrorMessage(new NetworkError("Backend nicht erreichbar (http://backend.test)."), "login"),
    USER_MESSAGE_COPY.network,
  );
  assert.equal(authErrorMessage(new ApiError(ENGLISH, 500), "login"), "Anmeldung fehlgeschlagen.");
  assert.equal(authErrorMessage(new ApiError(ENGLISH, 500), "register"), "Registrierung fehlgeschlagen.");
  assert.equal(authErrorMessage(new Error("nope"), "login"), "Anmeldung fehlgeschlagen.");
  assert.equal(authErrorMessage(new Error("nope"), "register"), "Registrierung fehlgeschlagen.");
  assert.equal(authErrorMessage(new ApiError(ENGLISH, 500), "login").includes(ENGLISH), false);
});

test("errorText never returns ApiError.message and maps status to German", () => {
  assert.equal(errorText(new ApiError(ENGLISH, 400), "Kontext."), USER_MESSAGE_COPY.invalidInput);
  assert.equal(errorText(new ApiError(ENGLISH, 422), "Kontext."), USER_MESSAGE_COPY.invalidInput);
  assert.equal(errorText(new ApiError("Unauthorized", 401), "Kontext."), LOGIN_EXPIRED_COPY);
  assert.equal(errorText(new ApiError("Forbidden", 403), "Kontext."), USER_MESSAGE_COPY.forbidden);
  assert.equal(errorText(new ApiError("Layer not found", 404), "Kontext."), USER_MESSAGE_COPY.notFound);
  assert.equal(errorText(new ApiError("Conflict", 409), "Kontext."), USER_MESSAGE_COPY.conflict);
  assert.equal(errorText(new ApiError("Too Many Requests", 429), "Kontext."), USER_MESSAGE_COPY.tooManyRequests);
  assert.equal(errorText(new ApiError("Internal Server Error", 500), "Kontext."), USER_MESSAGE_COPY.serverUnavailable);
  assert.equal(errorText(new ApiError("Bad Gateway", 502), "Kontext."), USER_MESSAGE_COPY.serverUnavailable);
  assert.equal(
    errorText(new NetworkError("Backend nicht erreichbar (http://backend.test)."), "Kontext."),
    USER_MESSAGE_COPY.network,
  );
  assert.equal(errorText(new Error("nope"), "Standorte konnten nicht geladen werden."), "Standorte konnten nicht geladen werden.");
  assert.equal(errorText(new ApiError(ENGLISH, 404), "Kontext.").includes(ENGLISH), false);
  assert.equal(errorText(new ApiError("Unauthorized", 401), "Kontext."), USER_MESSAGE_COPY.sessionExpired);
});

test("known backend codes get dedicated German; unknown codes use the context fallback", () => {
  assert.equal(
    errorText(new ApiError("Marked target region not found", 404, MARKED_TARGET_REGION_NOT_FOUND_CODE), "Kontext."),
    USER_MESSAGE_COPY.markedTargetRegionMissing,
  );
  assert.equal(
    errorText(new ApiError("Something exploded", 500, "unknown_backend_code"), "Empfehlungen konnten nicht geladen werden."),
    "Empfehlungen konnten nicht geladen werden.",
  );
  assert.equal(
    errorText(new ApiError("Something exploded", 500, "unknown_backend_code"), "Kontext.").includes("Something exploded"),
    false,
  );
  assert.equal(
    errorText(new ApiError("Something exploded", 500, "unknown_backend_code"), "Kontext.").includes("unknown_backend_code"),
    false,
  );
});

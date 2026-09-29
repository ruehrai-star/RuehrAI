import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "./api/types.ts";
import { authErrorMessage } from "./user-message.ts";

test("auth errors use the UX-gate wording", () => {
  assert.equal(
    authErrorMessage(new ApiError("Invalid email or password", 401), "login"),
    "E-Mail oder Passwort ist ungültig.",
  );
  assert.equal(
    authErrorMessage(new ApiError("Email already registered", 409), "register"),
    "Diese E-Mail ist bereits registriert.",
  );
  assert.equal(authErrorMessage(new ApiError("bad", 400), "register"), "Die Angaben sind ungültig.");
  assert.match(authErrorMessage(new ApiError("Backend nicht erreichbar (x).", 0), "login"), /Backend nicht erreichbar/);
  assert.equal(authErrorMessage(new Error("nope"), "login"), "Anmeldung fehlgeschlagen.");
  assert.equal(authErrorMessage(new Error("nope"), "register"), "Registrierung fehlgeschlagen.");
});

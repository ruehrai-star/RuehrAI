import assert from "node:assert/strict";
import { test } from "node:test";
import { grainLabel } from "./format.ts";

test("grain badges stay German and other ags keys stay Gemeinde", () => {
  assert.equal(grainLabel("address"), "Adresse");
  assert.equal(grainLabel("grid100"), "100-m-Gitter");
  assert.equal(grainLabel("plz8"), "PLZ8");
  assert.equal(grainLabel("plz5"), "PLZ");
  assert.equal(grainLabel("ags"), "Gemeinde");
  assert.equal(grainLabel("ags", "09162000"), "Gemeinde");
  assert.equal(grainLabel("ags", "11000000"), "Gemeinde");
  assert.equal(grainLabel("ags", "ags:11000000"), "Gemeinde");
  assert.equal(grainLabel("ags", "11000013"), "Gemeinde");
  assert.equal(grainLabel("ags5"), "Kreis");
  assert.equal(grainLabel("other"), "Sonstiges");
  assert.equal(grainLabel("plz5", "11000001"), "PLZ");
});

test("Berlin Bezirk AGS 11000001–11000012 uses the Bezirk badge", () => {
  assert.equal(grainLabel("ags", "11000001"), "Bezirk");
  assert.equal(grainLabel("ags", "11000009"), "Bezirk");
  assert.equal(grainLabel("ags", "11000010"), "Bezirk");
  assert.equal(grainLabel("ags", "11000012"), "Bezirk");
  assert.equal(grainLabel("ags", "ags:11000007"), "Bezirk");
  assert.equal(grainLabel("ags", " 11000004 "), "Bezirk");
  assert.equal(grainLabel("ags", null), "Gemeinde");
  assert.equal(grainLabel("ags", ""), "Gemeinde");
  assert.equal(grainLabel("ags", "1100001"), "Gemeinde");
});

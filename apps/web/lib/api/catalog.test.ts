import assert from "node:assert/strict";
import { test } from "node:test";
import { GRID_LAYER_ID, gridLayer, searchCatalog } from "./catalog.ts";

test("GET /search matches a PLZ and ranks the PLZ hit first", () => {
  const results = searchCatalog("80331");
  assert.equal(results[0]?.id, "plz5:80331");
  assert.equal(results[0]?.grain, "plz5");
  assert.ok(results.some((hit) => hit.grain === "address"));
});

test("GET /search matches an AGS", () => {
  const results = searchCatalog("09162000");
  assert.equal(results[0]?.id, "ags:09162000");
  assert.equal(results[0]?.grain, "ags");
  assert.equal(results[0]?.lon !== undefined && results[0]?.lat !== undefined, true);
});

test("address query and umlaut folding find München", () => {
  const byStreet = searchCatalog("Marienplatz");
  assert.ok(byStreet.some((hit) => hit.id === "80331|MUENCHEN|MARIENPLATZ|1|"));
  const folded = searchCatalog("muenchen");
  assert.ok(folded.some((hit) => hit.id === "ags:09162000"));
});

test("grid id is searchable and the layer is a polygon collection", () => {
  const id = "CRS3035RES100mN2761400E4268700";
  const results = searchCatalog(id);
  assert.equal(results[0]?.id, id);
  assert.equal(results[0]?.grain, "grid100");

  const layer = gridLayer();
  assert.equal(GRID_LAYER_ID, "grid100");
  assert.equal(layer.type, "FeatureCollection");
  assert.equal(layer.features.length, 12);
  assert.equal(layer.features[0]?.geometry.type, "Polygon");
  assert.equal(layer.features[0]?.properties?.id, id);
});

test("short queries return no hits", () => {
  assert.deepEqual(searchCatalog(" "), []);
  assert.deepEqual(searchCatalog("a"), []);
});

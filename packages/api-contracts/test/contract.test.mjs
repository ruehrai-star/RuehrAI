import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

const root = new URL("..", import.meta.url);
const yamlText = readFileSync(new URL("openapi/openapi.yaml", root), "utf8");
const jsonText = readFileSync(new URL("openapi/openapi.json", root), "utf8");

test("openapi yaml and json stay in sync", () => {
  assert.deepStrictEqual(JSON.parse(jsonText), parse(yamlText));
});

test("v0 covers health, auth, search, and layers", () => {
  const doc = JSON.parse(jsonText);
  assert.equal(doc.openapi.startsWith("3."), true);
  assert.equal(doc.info.version, "0.1.0");
  assert.ok(doc.servers.some((server) => server.url === "http://localhost:3000"));
  assert.deepEqual(doc.paths["/health"].get.security, []);
  assert.deepEqual(doc.paths["/auth/login"].post.security, []);
  assert.deepEqual(doc.paths["/auth/register"].post.security, []);
  assert.equal(doc.paths["/auth/me"].get.security, undefined);
  assert.equal(doc.paths["/search"].get.security, undefined);
  assert.equal(doc.paths["/layers/{id}"].get.security, undefined);
  assert.deepEqual(doc.security, [{ bearerAuth: [] }]);

  const searchParams = doc.paths["/search"].get.parameters.map((parameter) => parameter.name);
  for (const name of ["q", "type", "address", "ags", "plz", "geoKey", "grain"]) {
    assert.ok(searchParams.includes(name), name);
  }
  assert.equal(doc.components.schemas.SearchHit.properties.geoKey.nullable, true);

  const hitRequired = doc.components.schemas.SearchHit.required;
  assert.deepEqual(hitRequired, ["id", "label", "grain"]);
  assert.equal(doc.components.schemas.FeatureCollection.properties.type.enum[0], "FeatureCollection");
});

test("the contract does not mention Supabase", () => {
  assert.equal(/supabase/i.test(yamlText), false);
  assert.equal(/supabase/i.test(jsonText), false);
});

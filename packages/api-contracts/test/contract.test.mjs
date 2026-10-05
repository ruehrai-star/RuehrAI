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

test("v0.9 covers health, auth, search, layers, customer inputs, analysis, recommendations, the target-region list, and address-pair", () => {
  const doc = JSON.parse(jsonText);
  assert.equal(doc.openapi.startsWith("3."), true);
  assert.equal(doc.info.version, "0.9.0");
  assert.ok(doc.servers.some((server) => server.url === "http://localhost:3000"));
  assert.deepEqual(doc.paths["/health"].get.security, []);
  assert.deepEqual(doc.paths["/auth/login"].post.security, []);
  assert.deepEqual(doc.paths["/auth/register"].post.security, []);
  assert.equal(doc.paths["/auth/me"].get.security, undefined);
  assert.equal(doc.paths["/auth/logout"].post.security, undefined);
  assert.equal(doc.paths["/auth/logout"].post.responses["204"].description.length > 0, true);
  assert.equal(doc.paths["/target-region"].get.operationId, "listTargetRegions");
  assert.equal(doc.paths["/target-region"].post.operationId, "addTargetRegion");
  assert.equal(doc.paths["/target-region"].delete.operationId, "clearTargetRegions");
  assert.equal(doc.paths["/target-region"].put, undefined);
  assert.equal(doc.paths["/target-region/{geoKey}"].delete.operationId, "removeTargetRegion");
  assert.equal(doc.paths["/stores"].post.operationId, "createStore");
  assert.equal(doc.paths["/stores/{id}"].delete.operationId, "deleteStore");
  assert.equal(doc.paths["/stores/{id}/revenue"].put.operationId, "putStoreRevenue");
  assert.equal(
    doc.paths["/stores/{id}/revenue/{year}/{month}"].delete.operationId,
    "deleteStoreRevenueMonth",
  );
  assert.equal(doc.components.schemas.MonthlyRevenuePoint.properties.revenueEur.nullable, true);
  assert.equal(doc.components.schemas.MonthlyRevenuePoint.required.includes("revenueEur"), true);
  assert.equal(doc.paths["/search"].get.security, undefined);
  assert.equal(doc.paths["/layers/{id}"].get.security, undefined);
  assert.deepEqual(doc.security, [{ bearerAuth: [] }]);

  const searchParams = doc.paths["/search"].get.parameters.map((parameter) => parameter.name);
  for (const name of ["q", "type", "address", "ags", "plz", "geoKey", "grain"]) {
    assert.ok(searchParams.includes(name), name);
  }
  assert.equal(doc.components.schemas.SearchHit.properties.geoKey.nullable, true);
  assert.deepEqual(doc.components.schemas.CatalogLevel.enum, [
    "plz",
    "bezirk",
    "stadtbezirk",
    "stadtteil",
    "ortsteil",
    "gemeinde",
  ]);
  assert.equal(doc.components.schemas.SearchHit.properties.parentLabel.nullable, true);
  assert.equal(doc.components.schemas.SearchHit.properties.parent, undefined);
  assert.equal(doc.components.schemas.SearchHit.properties.level.nullable, true);

  const hitRequired = doc.components.schemas.SearchHit.required;
  assert.deepEqual(hitRequired, ["id", "label", "grain"]);
  assert.equal(doc.components.schemas.FeatureCollection.properties.type.enum[0], "FeatureCollection");

  assert.equal(doc.paths["/analysis/input"].get.operationId, "getAnalysisInput");
  assert.equal(doc.paths["/analysis/runs"].post.operationId, "createAnalysisRun");
  assert.equal(doc.paths["/analysis/runs/{id}"].get.operationId, "getAnalysisRun");
  assert.equal(doc.paths["/analysis/pattern"].get.operationId, "getAnalysisPattern");
  assert.equal(doc.paths["/analysis/input"].get.security, undefined);
  assert.equal(doc.paths["/recommendations"].post.operationId, "createRecommendations");
  assert.equal(doc.paths["/recommendations"].get.operationId, "getRecommendations");
  assert.equal(doc.paths["/recommendations"].post.security, undefined);
  assert.equal(doc.paths["/recommendations"].get.security, undefined);
  const recommendation = doc.components.schemas.Recommendation;
  assert.deepEqual(recommendation.required, [
    "id",
    "rank",
    "title",
    "location",
    "score",
    "rationale",
    "criteriaEvidence",
    "source",
  ]);
  assert.deepEqual(recommendation.properties.source.enum, ["llm", "heuristic"]);
  assert.equal(recommendation.properties.rank.minimum, 1);
  assert.equal(recommendation.properties.rank.maximum, 3);
  assert.equal(doc.components.schemas.RecommendationSet.properties.reason.nullable, true);
  assert.equal(doc.components.schemas.RecommendationSet.properties.items.maxItems, 3);
  assert.equal(doc.components.schemas.RecommendationLocation.properties.lon.nullable, true);
  assert.equal(doc.components.schemas.AnalysisPattern.properties.source.enum.includes("heuristic"), true);
  assert.equal(doc.components.schemas.AnalysisPattern.properties.source.enum.includes("llm"), true);
  assert.equal(doc.components.schemas.AnalysisPattern.required.includes("yearlySeries"), false);
  assert.equal(
    doc.components.schemas.AnalysisPattern.properties.yearlySeries.items.$ref,
    "#/components/schemas/YearlySeries",
  );
  const series = doc.components.schemas.YearlySeries;
  assert.deepEqual(series.required, [
    "metricId",
    "requestedLevel",
    "requestedGeoKey",
    "sourceLevel",
    "sourceGeoKey",
    "granularity",
    "coverage",
    "points",
  ]);
  assert.deepEqual(doc.components.schemas.SeriesCoverage.enum, ["none", "single", "multi"]);
  assert.deepEqual(doc.components.schemas.SeriesGranularity.enum, ["month", "year"]);
  assert.deepEqual(doc.components.schemas.SeriesPointStatus.enum, ["present", "absent"]);
  assert.equal(doc.components.schemas.SeriesPoint.required.includes("value"), false);
  assert.ok(doc.components.schemas.SeriesPointStatus.description.includes("Placeholder zeros"));
  assert.ok(doc.components.schemas.SeriesPoint.properties.value.description.includes("ba_schluessel"));
  assert.ok(doc.components.schemas.SeriesLevel.enum.includes("gemeinde"));
  assert.ok(doc.components.schemas.SeriesLevel.enum.includes("kreis"));
  assert.ok(doc.info.description.includes("yearlySeries"));
  assert.ok(doc.info.description.includes("0.9.0"));
  assert.ok(doc.components.schemas.YearlySeries.properties.metricId.description.includes("destatis_wohnungen"));
  assert.ok(doc.info.description.includes("ba_sgb2"));
  assert.equal(doc.components.schemas.AnalysisBrain.properties.mode.enum.includes("vector"), true);
  assert.equal(doc.components.schemas.AnalysisBrain.properties.mode.enum.includes("sql"), true);

  const region = doc.components.schemas.TargetRegion;
  assert.deepEqual(
    ["label", "bounds", "geometry", "updatedAt"].every((name) => region.required.includes(name)),
    true,
  );
  assert.equal(region.properties.bounds.nullable, true);
  assert.equal(region.properties.geometry.nullable, true);
  assert.equal(region.properties.level.nullable, true);
  assert.equal(region.properties.parentLabel.nullable, true);
  assert.equal(region.properties.lon.description.includes("WGS84"), true);
  assert.deepEqual(doc.components.schemas.TargetRegionList.required, ["items"]);
  assert.equal(
    doc.components.schemas.TargetRegionList.properties.items.items.$ref,
    "#/components/schemas/TargetRegion",
  );
  assert.deepEqual(doc.components.schemas.LonLatBounds.required, ["west", "south", "east", "north"]);
  assert.deepEqual(doc.components.schemas.RegionGeometry.properties.type.enum, [
    "Polygon",
    "MultiPolygon",
  ]);
  assert.equal(doc.components.schemas.StoreLocation.properties.lon.nullable, true);
  assert.equal(doc.components.schemas.StoreLocation.properties.lon.description.includes("WGS84"), true);
  assert.equal(doc.components.schemas.StoreLocationWrite.properties.lat.description.includes("WGS84"), true);
  assert.equal(doc.components.schemas.TargetRegionWrite.properties.geometry.nullable, true);
  assert.equal(
    doc.components.schemas.AnalysisInput.properties.regions.items.$ref,
    "#/components/schemas/TargetRegion",
  );
  assert.equal(doc.components.schemas.AnalysisInput.required.includes("regions"), false);

  assert.equal(doc.paths["/address-pair"].post.operationId, "evaluateAddressPair");
  assert.equal(doc.paths["/address-pair"].post.security, undefined);
  assert.deepEqual(doc.paths["/address-pair"].post.requestBody.required, true);
  assert.deepEqual(doc.components.schemas.AddressPairRequest.required, ["left", "right"]);
  assert.deepEqual(doc.components.schemas.AddressPairResult.required, ["left", "right", "shared"]);
  assert.deepEqual(doc.components.schemas.AddressSide.required, [
    "input",
    "resolution",
    "gemeinde",
    "kreis",
    "land",
    "topics",
  ]);
  assert.deepEqual(doc.components.schemas.AddressResolution.enum, ["resolved", "unknown"]);
  assert.deepEqual(doc.components.schemas.TopicLevel.enum, ["gemeinde", "kreis", "land"]);
  assert.deepEqual(doc.components.schemas.TopicStatus.enum, ["present", "absent"]);
  assert.equal(doc.components.schemas.AddressTopic.required.includes("value"), false);
  assert.equal(doc.components.schemas.AddressSide.properties.land.nullable, true);
  assert.equal(doc.components.schemas.AddressInput.properties.postalCode.pattern, "^[0-9]{5}$");
});

test("the contract does not mention Supabase", () => {
  assert.equal(/supabase/i.test(yamlText), false);
  assert.equal(/supabase/i.test(jsonText), false);
});

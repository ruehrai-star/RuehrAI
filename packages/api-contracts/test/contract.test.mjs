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

test("v0.12 covers health, auth, search, layers, customer inputs, analysis, recommendations, the target-region list, and address-pair", () => {
  const doc = JSON.parse(jsonText);
  assert.equal(doc.openapi.startsWith("3."), true);
  assert.equal(doc.info.version, "0.19.4");
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
  assert.equal(
    doc.paths["/analysis/pattern"].get.parameters[0].$ref,
    "#/components/parameters/AnalysisPatternGeoKey",
  );
  assert.equal(doc.components.parameters.AnalysisPatternGeoKey.name, "geoKey");
  assert.equal(doc.components.parameters.AnalysisPatternGeoKey.in, "query");
  assert.equal(doc.components.parameters.AnalysisPatternGeoKey.required, false);
  assert.deepEqual(doc.components.schemas.AnalysisPatternResponse.required, [
    "runId",
    "createdAt",
    "region",
    "pattern",
  ]);
  assert.equal(
    doc.components.schemas.AnalysisPatternResponse.properties.region.$ref,
    "#/components/schemas/AnalysisPatternRegion",
  );
  assert.deepEqual(doc.components.schemas.AnalysisPatternRegion.required, ["label", "geoKey"]);
  assert.equal(doc.components.schemas.AnalysisPatternRegion.properties.geoKey.nullable, true);
  assert.ok(doc.info.description.includes("0.12.0"));
  assert.ok(doc.info.description.includes("0.12.1"));
  assert.ok(doc.info.description.includes("0.13.0"));
  assert.ok(doc.info.description.includes("0.14.0"));
  assert.ok(doc.info.description.includes("0.15.0"));
  assert.ok(doc.info.description.includes("0.16.0"));
  assert.ok(doc.info.description.includes("0.18.0"));
  assert.ok(doc.info.description.includes("0.18.1"));
  assert.ok(doc.info.description.includes("0.19.0"));
  assert.ok(doc.info.description.includes("0.19.1"));
  assert.ok(doc.info.description.includes("0.19.2"));
  assert.ok(doc.info.description.includes("0.19.3"));
  assert.ok(doc.info.description.includes("0.19.4"));
  assert.ok(doc.info.description.includes("ANALYSIS_SCORE_TREND_WEIGHT"));
  assert.ok(doc.info.description.includes("ANALYSIS_MIN_OVERLAP_SHARE"));
  assert.ok(doc.info.description.includes("year span"));
  assert.equal(doc.components.schemas.RecommendationEvidence.properties.proximity.type, "number");
  assert.equal(doc.components.schemas.RecommendationEvidence.properties.proximity.minimum, 0);
  assert.equal(doc.components.schemas.RecommendationEvidence.properties.proximity.maximum, 1);
  assert.equal(doc.components.schemas.RecommendationEvidence.required.includes("proximity"), false);
  assert.equal(doc.components.schemas.RecommendationEvidence.properties.trendYears.type, "integer");
  assert.equal(doc.components.schemas.RecommendationEvidence.properties.trendYears.minimum, 2);
  assert.equal(doc.components.schemas.RecommendationEvidence.required.includes("trendYears"), false);
  assert.ok(doc.components.schemas.Recommendation.properties.score.description.includes("robust"));
  assert.ok(doc.components.schemas.RecommendationEvidence.properties.proximity.description.includes("0.19.4"));
  assert.ok(doc.paths["/recommendations"].get.description.includes("never computes") ||
    doc.paths["/recommendations"].get.description.includes("Never ranks"));
  assert.equal(
    doc.paths["/recommendations"].get.parameters[0].$ref,
    "#/components/parameters/RecommendationsRunId",
  );
  assert.equal(doc.components.parameters.RecommendationsRunId.name, "runId");
  assert.equal(doc.components.parameters.RecommendationsRunId.in, "query");
  assert.equal(doc.components.parameters.RecommendationsRunId.required, false);
  assert.ok(doc.paths["/analysis/runs"].post.description.includes("recommendation set"));
  assert.ok(doc.paths["/analysis/runs"].post.description.includes("markedTargetRegionGeoKey"));
  assert.equal(
    doc.paths["/analysis/runs"].post.requestBody.content["application/json"].schema.$ref,
    "#/components/schemas/AnalysisRunCreate",
  );
  assert.equal(
    doc.components.schemas.AnalysisRunCreate.properties.markedTargetRegionGeoKey.type,
    "string",
  );
  assert.equal(doc.components.schemas.AnalysisRunCreate.properties.geoKey.type, "string");
  assert.equal(doc.components.schemas.AnalysisRunCreate.required, undefined);
  assert.equal(
    doc.paths["/analysis/runs"].post.parameters[0].$ref,
    "#/components/parameters/AnalysisRunCreateGeoKey",
  );
  assert.ok(doc.info.description.includes("marked_target_region_not_found"));
  assert.ok(doc.paths["/analysis/pattern"].get.description.includes("rebuilt"));
  assert.equal(doc.components.schemas.ErrorResponse.properties.code.type, "string");
  assert.ok(doc.info.description.includes("official_zensus2022_grid"));
  assert.ok(doc.info.description.includes("estimate_zensus2022_grid_sum"));
  assert.ok(doc.info.description.includes("geo.area_baseline"));
  assert.ok(doc.info.description.includes("baselineMethod"));
  assert.ok(doc.info.description.includes("patternByLevel"));
  assert.ok(doc.info.description.includes("patternByDataset"));
  assert.ok(doc.info.description.includes("per_1000_inhabitants"));
  assert.ok(doc.info.description.includes("lor:plr"));
  assert.ok(doc.info.description.includes("koeln:sq"));
  assert.ok(doc.info.description.includes("geo.geo_ref_address"));
  assert.ok(doc.info.description.includes("koeln_statistischer_datenkatalog"));
  assert.ok(doc.info.description.includes("hamburg_stadtteil_regionalstatistik"));
  assert.ok(doc.info.description.includes("muenchen_indikatorenatlas"));
  assert.ok(doc.info.description.includes("berlin_lor_ewr_bevoelkerung"));
  assert.ok(doc.info.description.includes("Teilflächen"));
  assert.ok(doc.paths["/analysis/pattern"].get.description.includes("geoKey"));
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
    "kind",
    "location",
    "score",
    "rationale",
    "criteriaEvidence",
    "source",
    "name",
    "targetRegionGeoKey",
  ]);
  assert.deepEqual(recommendation.properties.source.enum, ["llm", "heuristic"]);
  assert.equal(recommendation.properties.rank.minimum, 1);
  assert.equal(recommendation.properties.rank.maximum, 200);
  assert.equal(
    recommendation.properties.rank.description,
    "je Zielregion (targetRegionGeoKey) 1-basiert und lückenlos, über alle Ebenen gemeinsam nach score absteigend",
  );
  assert.equal(recommendation.properties.targetRegionGeoKey.type, "string");
  assert.equal(recommendation.required.includes("targetRegionGeoKey"), true);
  assert.ok(recommendation.properties.targetRegionGeoKey.description.includes("geoKey"));
  assert.ok(recommendation.properties.targetRegionGeoKey.description.includes("ags:{ags}"));
  assert.ok(recommendation.properties.targetRegionGeoKey.description.includes("label:{normalized label}"));
  assert.ok(recommendation.properties.targetRegionGeoKey.description.includes("targetRegions"));
  assert.equal(doc.components.schemas.RecommendationSet.required.includes("targetRegions"), false);
  assert.equal(
    doc.components.schemas.RecommendationSet.properties.targetRegions.items.$ref,
    "#/components/schemas/RecommendationTargetRegion",
  );
  assert.equal(doc.components.schemas.RecommendationSet.properties.targetRegions.maxItems, 200);
  assert.ok(doc.components.schemas.RecommendationSet.properties.targetRegions.description.includes("ags:{ags}"));
  assert.ok(doc.components.schemas.RecommendationSet.properties.targetRegions.description.includes("floor(200/n)"));
  assert.ok(doc.components.schemas.RecommendationTargetRegion.required.includes("geoKey"));
  assert.equal(doc.components.schemas.TargetRegionList.properties.items.maxItems, undefined);
  assert.ok(doc.components.schemas.TargetRegionList.properties.items.description.includes("No per-user maxItems"));
  assert.ok(doc.components.schemas.AnalysisInput.properties.regions.description.includes("200"));
  assert.ok(doc.paths["/analysis/runs"].post.responses["400"].description.includes("200"));
  assert.ok(doc.info.description.includes("n ≤ 66"));
  assert.equal(recommendation.properties.dataAsOf.type, "string");
  assert.equal(recommendation.properties.dataAsOf.nullable, true);
  assert.equal(recommendation.required.includes("dataAsOf"), false);
  assert.ok(recommendation.properties.dataAsOf.description.includes("YYYY"));
  assert.ok(recommendation.properties.dataAsOf.description.includes("criteriaEvidence.points"));
  assert.ok(recommendation.properties.dataAsOf.description.includes("patternByDataset"));
  assert.ok(recommendation.properties.dataAsOf.description.includes("Musterverlauf"));
  assert.equal(recommendation.properties.yearlySeries, undefined);
  assert.ok(recommendation.properties.id.description.includes("@{targetRegionGeoKey}"));
  assert.ok(doc.info.description.includes("patternByDataset[].yearlySeries"));
  assert.ok(doc.paths["/recommendations"].post.description.includes("targetRegionGeoKey"));
  assert.equal(doc.components.schemas.RecommendationSet.properties.reason.nullable, true);
  assert.equal(doc.components.schemas.RecommendationSet.properties.items.maxItems, 200);
  assert.equal(
    doc.components.schemas.RecommendationSet.properties.patternByLevel.items.$ref,
    "#/components/schemas/PatternLevelProfile",
  );
  assert.equal(doc.components.schemas.RecommendationSet.required.includes("patternByLevel"), false);
  assert.equal(
    doc.components.schemas.RecommendationSet.properties.patternByDataset.items.$ref,
    "#/components/schemas/PatternDatasetProfile",
  );
  assert.equal(doc.components.schemas.RecommendationSet.required.includes("patternByDataset"), false);
  assert.deepEqual(doc.components.schemas.SeriesBaseline.enum, [
    "per_1000_inhabitants",
    "per_km2",
    "per_household",
  ]);
  assert.deepEqual(doc.components.schemas.PatternDatasetProfile.required, [
    "metricId",
    "baseline",
    "sourceLevel",
    "sourceGeoKey",
    "yearlySeries",
    "criterion",
  ]);
  assert.equal(doc.components.schemas.PatternCriterion.properties.metricId.type, "string");
  assert.equal(
    doc.components.schemas.PatternCriterion.properties.baseline.$ref,
    "#/components/schemas/SeriesBaseline",
  );
  assert.equal(doc.components.schemas.PatternCriterion.properties.rawValue.type, "number");
  assert.equal(doc.components.schemas.PatternCriterion.properties.normalizedValue.type, "number");
  assert.equal(doc.components.schemas.SeriesPoint.properties.normalizedValue.type, "number");
  assert.deepEqual(doc.components.schemas.BaselineMethod.enum, [
    "official",
    "official_zensus2022_grid",
    "estimate_lor_sum",
    "estimate_zensus2022_grid_sum",
    "estimate_address",
    "missing",
    "geom",
    "fixed_grid",
  ]);
  assert.equal(
    doc.components.schemas.SeriesPoint.properties.baselineMethod.$ref,
    "#/components/schemas/BaselineMethod",
  );
  assert.equal(
    doc.components.schemas.PatternCriterion.properties.baselineMethod.$ref,
    "#/components/schemas/BaselineMethod",
  );
  assert.equal(
    doc.components.schemas.RecommendationEvidence.properties.baselineMethod.$ref,
    "#/components/schemas/BaselineMethod",
  );
  assert.equal(doc.components.schemas.PatternDatasetProfile.required.includes("baselineMethod"), false);
  assert.equal(doc.components.schemas.RecommendationEvidence.properties.metricId.type, "string");
  assert.equal(
    doc.components.schemas.RecommendationEvidence.properties.baseline.$ref,
    "#/components/schemas/SeriesBaseline",
  );
  assert.equal(doc.components.schemas.RecommendationEvidence.properties.rawValue.type, "number");
  assert.equal(doc.components.schemas.RecommendationEvidence.properties.normalizedValue.type, "number");
  assert.deepEqual(doc.components.schemas.PatternLevel.enum, [
    "address",
    "grid100",
    "lor",
    "quartier",
    "ortsteil",
    "plz",
    "bezirk",
    "gemeinde",
    "kreis",
  ]);
  assert.deepEqual(doc.components.schemas.PatternLevelRole.enum, ["pattern", "frame"]);
  assert.deepEqual(doc.components.schemas.PatternLevelProfile.required, [
    "level",
    "role",
    "geoKeys",
    "yearlySeries",
    "criteria",
  ]);
  assert.equal(doc.components.schemas.PatternCriterion.properties.scope.$ref, "#/components/schemas/EvidenceScope");
  assert.deepEqual(doc.components.schemas.AreaKind.enum, [
    "address",
    "grid100",
    "lor",
    "quartier",
    "ortsteil",
    "stadtteil",
    "plz",
    "bezirk",
    "stadtbezirk",
    "gemeinde",
  ]);
  assert.deepEqual(doc.components.schemas.EvidenceScope.enum, ["local", "inherited"]);
  assert.deepEqual(doc.components.schemas.CriterionKind.enum, ["trend", "stichtag"]);
  assert.deepEqual(doc.components.schemas.EvidenceKind.enum, ["trend", "stichtag", "absent"]);
  assert.ok(doc.components.schemas.RecommendationWindow.properties.from.pattern.includes("4"));
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
  assert.deepEqual(doc.components.schemas.SeriesCoverage.enum, ["none", "single", "multi", "series"]);
  assert.equal(doc.components.schemas.Recommendation.properties.geometry.nullable, true);
  assert.ok(doc.components.schemas.Recommendation.properties.geometryUnavailableReason);
  assert.equal(
    doc.components.schemas.Recommendation.properties.trend.$ref,
    "#/components/schemas/RecommendationTrend",
  );
  assert.deepEqual(doc.components.schemas.RecommendationTrend.required, ["direction", "summary"]);
  assert.equal(doc.components.schemas.RecommendationEvidence.properties.baselineMatch.type, "boolean");
  assert.equal(doc.components.schemas.PatternDatasetProfile.properties.baselineMatch.type, "boolean");
  assert.equal(recommendation.properties.grain.$ref, "#/components/schemas/Grain");
  assert.equal(recommendation.properties.name.nullable, undefined);
  assert.equal(recommendation.properties.name.type, "string");
  assert.ok(recommendation.properties.name.description.includes("PLZ 80331"));
  assert.ok(recommendation.properties.name.description.includes("100-m-Rasterzelle"));
  assert.ok(recommendation.properties.name.description.includes("ohne Namen"));
  assert.ok(recommendation.properties.name.description.includes("Adresse ohne Hausnummer"));
  assert.ok(recommendation.properties.name.description.includes("Planungsraum ohne Namen"));
  assert.ok(recommendation.properties.name.description.includes("never the LOR/PLR number"));
  assert.ok(recommendation.properties.name.description.includes("Quartier ohne Namen"));
  assert.ok(recommendation.properties.name.description.includes("never the Quartier id"));
  assert.ok(recommendation.properties.parentLabel.description.includes("Gemeinde"));
  assert.equal(recommendation.properties.parentLabel.nullable, true);
  assert.equal(recommendation.required.includes("grain"), false);
  assert.equal(recommendation.required.includes("name"), true);
  assert.equal(recommendation.required.includes("parentLabel"), false);
  assert.equal(recommendation.required.includes("intersectionOf"), false);
  assert.equal(recommendation.required.includes("overlaps"), false);
  assert.equal(
    recommendation.properties.intersectionOf.items.$ref,
    "#/components/schemas/RecommendationIntersectionPart",
  );
  assert.equal(
    recommendation.properties.overlaps.items.$ref,
    "#/components/schemas/RecommendationOverlap",
  );
  assert.deepEqual(doc.components.schemas.RecommendationOverlap.required, ["geoKey", "label", "kind", "share"]);
  assert.equal(doc.components.schemas.RecommendationOverlap.properties.share.minimum, 0);
  assert.equal(doc.components.schemas.RecommendationOverlap.properties.share.maximum, 1);
  assert.ok(recommendation.properties.overlaps.description.includes("1 %"));
  assert.ok(recommendation.properties.overlaps.description.includes("clipped"));
  assert.ok(recommendation.properties.overlaps.description.includes("grid100"));
  assert.deepEqual(doc.components.schemas.RecommendationIntersectionPart.required, ["geoKey", "grain", "name"]);
  assert.equal(doc.components.schemas.RecommendationIntersectionPart.properties.name.nullable, true);
  assert.equal(doc.components.schemas.RecommendationIntersectionPart.required.includes("datasetKey"), false);
  assert.equal(doc.components.schemas.RecommendationLocation.properties.grain.deprecated, true);
  assert.equal(doc.components.schemas.RecommendationLocation.properties.name.deprecated, true);
  assert.deepEqual(doc.components.schemas.AnalysisRunStatus.enum, [
    "queued",
    "running",
    "completed",
    "failed",
  ]);
  assert.equal(
    doc.components.schemas.AnalysisRun.properties.status.$ref,
    "#/components/schemas/AnalysisRunStatus",
  );
  assert.ok(doc.info.description.includes("202 Accepted"));
  assert.ok(doc.info.description.includes("every ~2 s"));
  assert.ok(doc.info.description.includes("ANALYSIS_RUN_DEADLINE_MS"));
  assert.ok(doc.paths["/analysis/runs"].post.responses["202"]);
  assert.equal(doc.paths["/analysis/runs"].post.responses["201"], undefined);
  assert.ok(doc.paths["/analysis/runs"].post.description.includes("every ~2 s"));
  assert.ok(doc.paths["/analysis/runs/{id}"].get.description.includes("404"));
  assert.deepEqual(doc.components.schemas.AnalysisRunFailureReason.enum, [
    "timeout",
    "pattern_failed",
    "set_save_failed",
    "interrupted",
    "internal_error",
  ]);
  assert.equal(
    doc.components.schemas.AnalysisRun.properties.failureReason.allOf[0].$ref,
    "#/components/schemas/AnalysisRunFailureReason",
  );
  assert.equal(doc.components.schemas.AnalysisRun.properties.failureReason.nullable, true);
  assert.equal(doc.components.schemas.AnalysisRun.properties.startedAt.nullable, true);
  assert.equal(doc.components.schemas.AnalysisRun.properties.completedAt.nullable, true);
  assert.equal(doc.components.schemas.AnalysisRun.required.includes("failureReason"), false);
  assert.ok(doc.info.description.includes("intersectionOf"));
  assert.ok(doc.info.description.includes("parentLabel"));
  assert.ok(doc.info.description.includes("queued"));

  assert.deepEqual(doc.components.schemas.SeriesGranularity.enum, ["month", "year"]);
  assert.deepEqual(doc.components.schemas.SeriesPointStatus.enum, ["present", "absent"]);
  assert.equal(doc.components.schemas.SeriesPoint.required.includes("value"), false);
  assert.ok(doc.components.schemas.SeriesPointStatus.description.includes("Placeholder zeros"));
  assert.ok(doc.components.schemas.SeriesPoint.properties.value.description.includes("ba_schluessel"));
  assert.ok(doc.components.schemas.SeriesPoint.properties.value.description.includes("dwellings"));
  assert.ok(doc.components.schemas.BrainSignal.properties.value.description.includes("whole numbers"));
  assert.ok(doc.components.schemas.BrainSignal.properties.value.description.includes("age-band"));
  assert.ok(doc.components.schemas.PatternCriterion.properties.evidence.description.includes("wohnungen.raeume"));
  assert.ok(doc.components.schemas.PatternCriterion.properties.evidence.description.includes("Filialumgebung"));
  assert.ok(doc.components.schemas.AnalysisPattern.properties.criteria.description.includes("05315"));
  assert.ok(doc.components.schemas.AnalysisPattern.properties.criteria.description.includes("bev_insgesamt"));
  assert.ok(doc.components.schemas.RecommendationEvidence.properties.evidence.description.includes("leaf"));
  assert.ok(doc.components.schemas.SeriesLevel.enum.includes("gemeinde"));
  assert.ok(doc.components.schemas.SeriesLevel.enum.includes("kreis"));
  assert.ok(doc.components.schemas.SeriesLevel.enum.includes("grid100"));
  assert.ok(doc.components.schemas.SeriesLevel.enum.includes("address"));
  assert.ok(doc.components.schemas.SeriesLevel.enum.includes("lor"));
  assert.ok(doc.components.schemas.SeriesLevel.enum.includes("quartier"));
  assert.ok(doc.components.schemas.SeriesLevel.enum.includes("address"));
  assert.ok(doc.info.description.includes("inherited"));
  assert.equal(
    doc.components.schemas.YearlySeries.properties.requestedLevel.$ref,
    "#/components/schemas/SeriesLevel",
  );
  assert.ok(doc.components.schemas.SeriesLevel.description.includes("ags5"));
  assert.ok(doc.info.description.includes("yearlySeries"));
  assert.ok(doc.info.description.includes("0.9.0"));
  assert.ok(doc.components.schemas.YearlySeries.properties.metricId.description.includes("destatis_wohnungen"));
  assert.ok(doc.components.schemas.YearlySeries.properties.metricId.description.includes("hamburg_stadtteil_regionalstatistik"));
  assert.ok(doc.components.schemas.YearlySeries.properties.metricId.description.includes("koeln_statistischer_datenkatalog"));
  assert.ok(doc.components.schemas.YearlySeries.description.includes("Ortsteil"));
  assert.ok(doc.info.description.includes("Ortsteil"));
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

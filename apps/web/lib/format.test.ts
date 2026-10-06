import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  catalogBadge,
  catalogHitVisibleText,
  catalogParentName,
  catalogPlaceName,
  grainLabel,
  isCatalogKey,
  isSubAreaLevel,
  visibleSavedRegions,
  visibleSearchHits,
} from "./format.ts";

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

test("catalog level maps exactly to one German badge", () => {
  assert.equal(catalogBadge({ level: "plz", grain: "ags", geoKey: "04229" }), "PLZ");
  assert.equal(catalogBadge({ level: "bezirk", grain: "ags", geoKey: "11000001" }), "Bezirk");
  assert.equal(catalogBadge({ level: "stadtbezirk", grain: "ags", geoKey: "14713000" }), "Stadtbezirk");
  assert.equal(catalogBadge({ level: "stadtteil", grain: "ags", geoKey: "14713000" }), "Stadtteil");
  assert.equal(catalogBadge({ level: "ortsteil", grain: "ags", geoKey: "14713000" }), "Ortsteil");
  assert.equal(catalogBadge({ level: "gemeinde", grain: "ags", geoKey: "09162000" }), "Gemeinde");
});

test("a sub-area is never Gemeinde and never shows Stadtteil plus Ortsteil", () => {
  for (const level of ["plz", "bezirk", "stadtbezirk", "stadtteil", "ortsteil"] as const) {
    const badge = catalogBadge({ level, grain: "ags", geoKey: "09162000" });
    assert.notEqual(badge, "Gemeinde");
    assert.ok(isSubAreaLevel(level));
    assert.notEqual(badge.includes("Stadtteil") && badge.includes("Ortsteil"), true);
  }
  assert.equal(catalogBadge({ level: "stadtteil" }), "Stadtteil");
  assert.notEqual(catalogBadge({ level: "stadtteil" }), "Ortsteil");
  assert.equal(catalogBadge({ level: "ortsteil" }), "Ortsteil");
  assert.notEqual(catalogBadge({ level: "ortsteil" }), "Stadtteil");
});

test("Berlin AGS 11000001–12 must not override a present level", () => {
  assert.equal(catalogBadge({ level: "stadtteil", grain: "ags", geoKey: "11000001" }), "Stadtteil");
  assert.equal(catalogBadge({ level: "ortsteil", grain: "ags", geoKey: "11000007" }), "Ortsteil");
  assert.equal(catalogBadge({ level: "stadtbezirk", grain: "ags", id: "ags:11000012" }), "Stadtbezirk");
  assert.equal(catalogBadge({ level: "plz", grain: "ags", geoKey: "11000004" }), "PLZ");
  assert.equal(catalogBadge({ grain: "ags", geoKey: "11000001" }), "Bezirk");
});

test("municipality hits without level keep Gemeinde", () => {
  assert.equal(catalogBadge({ grain: "ags", geoKey: "09162000" }), "Gemeinde");
  assert.equal(catalogBadge({ grain: "ags", geoKey: "11000000" }), "Gemeinde");
  assert.equal(catalogBadge({ grain: "other", geoKey: "lor:110010101" }), "Planungsraum");
  assert.equal(catalogBadge({ grain: "other", geoKey: "lor:plr:01100101" }), "Planungsraum");
  assert.equal(catalogBadge({ grain: "other", geoKey: "koeln:sq:123" }), "Quartier");
  assert.equal(catalogBadge({ grain: "ags", ags: "14713000" }), "Gemeinde");
});

test("API level gemeinde keeps Gemeinde and does not invent parentLabel", () => {
  const muenchen = {
    id: "ags:09162000",
    label: "München",
    grain: "ags" as const,
    geoKey: "09162000",
    level: "gemeinde" as const,
    parentLabel: "",
  };
  assert.equal(catalogBadge(muenchen), "Gemeinde");
  assert.equal(isSubAreaLevel("gemeinde"), false);
  assert.equal(catalogParentName(muenchen), null);
  assert.equal(catalogHitVisibleText(muenchen), "München · Gemeinde");
});

test("catalog keys are detected for every Zielregion level", () => {
  assert.equal(isCatalogKey("plz5:12247"), true);
  assert.equal(isCatalogKey("ortsteil:osm:5712247"), true);
  assert.equal(isCatalogKey("ortsteil:osm:12247773"), true);
  assert.equal(isCatalogKey("ortsteil:osm:12247949"), true);
  assert.equal(isCatalogKey("stadtteil:osm:9"), true);
  assert.equal(isCatalogKey("stadtteil:osm:2613711"), true);
  assert.equal(isCatalogKey("stadtbezirk:14713000"), true);
  assert.equal(isCatalogKey("bezirk:11000001"), true);
  assert.equal(isCatalogKey("lor:110010101"), true);
  assert.equal(isCatalogKey("lor:plr:01100101"), true);
  assert.equal(isCatalogKey("koeln:sq:123"), true);
  assert.equal(isCatalogKey("hamburg_stadtteil:117/118"), true);
  assert.equal(isCatalogKey("ags:09162000"), true);
  assert.equal(isCatalogKey("plz8:80331001"), true);
  assert.equal(isCatalogKey("other:ortsteil:osm:5712247"), true);
  assert.equal(isCatalogKey("12247"), false);
  assert.equal(isCatalogKey("Lankwitz"), false);
  assert.equal(isCatalogKey("Berlin"), false);
});

test("a hit with id plz5:12247 or ortsteil:osm:5712247 does not render that id", () => {
  const plz = {
    id: "plz5:12247",
    label: "12247",
    grain: "plz5" as const,
    geoKey: "12247",
    level: "plz" as const,
    parentLabel: "Berlin",
  };
  const namedOrtsteil = {
    id: "ortsteil:osm:5712247",
    label: "Lankwitz",
    grain: "other" as const,
    geoKey: "ortsteil:osm:5712247",
    level: "ortsteil" as const,
    parentLabel: "Berlin",
  };
  const plzText = catalogHitVisibleText(plz);
  const ortsteilText = catalogHitVisibleText(namedOrtsteil);
  assert.equal(plzText.includes("plz5:12247"), false);
  assert.equal(ortsteilText.includes("ortsteil:osm:5712247"), false);
  assert.equal(plzText, "12247 · PLZ · Berlin");
  assert.equal(ortsteilText, "Lankwitz · Ortsteil · Berlin");
  assert.equal(catalogPlaceName(plz), "12247");
  assert.equal(catalogPlaceName(namedOrtsteil), "Lankwitz");
});

test("a hit without a place name is dropped even when badge or parentLabel exist", () => {
  const keyOnly = {
    id: "ortsteil:osm:5712247",
    label: "ortsteil:osm:5712247",
    grain: "other" as const,
    geoKey: "ortsteil:osm:5712247",
    level: "ortsteil" as const,
    parentLabel: "Berlin",
  };
  const blank = {
    id: "plz5:12247",
    label: "  ",
    grain: "plz5" as const,
    geoKey: "plz5:12247",
    level: "plz" as const,
    parentLabel: "Berlin",
  };
  const named = {
    id: "plz5:12247",
    label: "12247",
    grain: "plz5" as const,
    geoKey: "12247",
    level: "plz" as const,
  };
  assert.equal(catalogPlaceName(keyOnly), null);
  assert.equal(catalogPlaceName(blank), null);
  assert.equal(catalogHitVisibleText(keyOnly), "");
  assert.deepEqual(
    visibleSearchHits([keyOnly, blank, named]).map((hit) => hit.label),
    ["12247"],
  );
  assert.deepEqual(
    visibleSavedRegions([keyOnly, blank, named]).map((item) => item.label),
    ["12247"],
  );
});

test("a saved Zielregion row without a place name is omitted from the list", () => {
  const nameless = {
    label: "ortsteil:osm:5712247",
    geoKey: "ortsteil:osm:5712247",
    grain: "other" as const,
    level: "ortsteil" as const,
    parentLabel: "Berlin",
  };
  const blank = { label: "  ", geoKey: "ags:09162000", grain: "ags" as const };
  const named = { label: "München", geoKey: "09162000", grain: "ags" as const };
  assert.equal(catalogPlaceName(nameless), null);
  assert.deepEqual(
    visibleSavedRegions([nameless, blank, named]).map((item) => item.label),
    ["München"],
  );
});

test("Bezirke and Stadtteile show the municipality via parentLabel", () => {
  const innenstadt = {
    id: "stadtbezirk:osm:1",
    label: "Innenstadt",
    grain: "other" as const,
    geoKey: "stadtbezirk:osm:1",
    level: "bezirk" as const,
    parentLabel: "Köln",
  };
  const ehrenfeld = {
    id: "stadtteil:osm:2",
    label: "Ehrenfeld",
    grain: "other" as const,
    geoKey: "stadtteil:osm:2",
    level: "stadtteil" as const,
    parentLabel: "Köln",
  };
  const nippes = {
    id: "stadtbezirk:osm:3",
    label: "Nippes",
    grain: "other" as const,
    geoKey: "stadtbezirk:osm:3",
    level: "stadtbezirk" as const,
    parentLabel: "Köln",
  };
  const lankwitz = {
    id: "ortsteil:osm:4",
    label: "Lankwitz",
    grain: "other" as const,
    geoKey: "ortsteil:osm:4",
    level: "ortsteil" as const,
    parentLabel: "Berlin",
  };
  assert.equal(catalogHitVisibleText(innenstadt), "Innenstadt · Bezirk · Köln");
  assert.equal(catalogHitVisibleText(ehrenfeld), "Ehrenfeld · Stadtteil · Köln");
  assert.equal(catalogHitVisibleText(nippes), "Nippes · Stadtbezirk · Köln");
  assert.equal(catalogHitVisibleText(lankwitz), "Lankwitz · Ortsteil · Berlin");
  assert.equal(catalogHitVisibleText({ ...innenstadt, parentLabel: "" }), "Innenstadt · Bezirk");
  assert.equal(catalogHitVisibleText({ ...innenstadt, parentLabel: null }), "Innenstadt · Bezirk");
  assert.equal(catalogHitVisibleText(innenstadt).includes("stadtbezirk"), false);
  assert.equal(catalogHitVisibleText(innenstadt).includes("ags"), false);
});

test("search hits from the server are shown as-is; name and Gemeinde order is not filtered client-side", () => {
  const hits = [
    {
      id: "stadtbezirk:osm:1",
      label: "Innenstadt",
      grain: "other" as const,
      level: "stadtbezirk" as const,
      parentLabel: "Köln",
    },
    {
      id: "ags:05315000",
      label: "Köln",
      grain: "ags" as const,
      level: "gemeinde" as const,
      parentLabel: null,
    },
  ];
  assert.deepEqual(
    visibleSearchHits(hits).map((hit) => catalogHitVisibleText(hit)),
    ["Innenstadt · Stadtbezirk · Köln", "Köln · Gemeinde"],
  );
  const region = readFileSync(new URL("../components/region-section.tsx", import.meta.url), "utf8");
  assert.match(region, /\.search\(trimmed\)/);
  assert.equal(region.includes("query.split"), false);
  assert.equal(region.includes("parentLabel.includes"), false);
  assert.equal(region.includes("label.toLowerCase"), false);
});
test("parentLabel stays empty when the field is missing; no parent name is guessed", () => {
  const hit = {
    id: "plz5:12247",
    label: "12247",
    grain: "plz5" as const,
    parentName: "Berlin",
    municipalityName: "Berlin",
  };
  assert.equal(catalogParentName(hit), null);
  assert.equal(catalogHitVisibleText(hit), "12247 · PLZ");
});

test("Zielregion search copy has no AGS, no München, and no AGS example", () => {
  const region = readFileSync(new URL("../components/region-section.tsx", import.meta.url), "utf8");
  assert.equal(region.includes("AGS"), false);
  assert.equal(region.includes("09162000"), false);
  assert.equal(region.includes("München"), false);
  assert.match(region, /placeholder=\{REGION_LIST_COPY.searchPlaceholder\}/);
  assert.match(region, /REGION_LIST_COPY.noHits/);
  assert.match(region, /REGION_LIST_COPY.empty/);
  assert.match(region, /REGION_LIST_COPY.added/);
  assert.equal(region.includes("Gemeinde"), false);
});

test("search-panel user-visible copy has no AGS and no 09162000", () => {
  const search = readFileSync(new URL("../components/search-panel.tsx", import.meta.url), "utf8");
  assert.equal(search.includes("AGS"), false);
  assert.equal(search.includes("09162000"), false);
  assert.equal(search.includes("Gemeinde"), false);
  assert.match(search, /Keine Treffer\. Adresse oder PLZ versuchen\./);
  assert.match(search, /const EXAMPLES = \["München", "80331", "Marienplatz", "Berlin"\]/);
});

test("Zielregion and search markup never interpolate catalog id or geoKey as visible text", () => {
  const region = readFileSync(new URL("../components/region-section.tsx", import.meta.url), "utf8");
  const search = readFileSync(new URL("../components/search-panel.tsx", import.meta.url), "utf8");
  const recommendations = readFileSync(new URL("../components/empfehlungen-page.tsx", import.meta.url), "utf8");
  const verlauf = readFileSync(new URL("../components/verlauf-page.tsx", import.meta.url), "utf8");
  const recModel = readFileSync(new URL("./recommendations/model.ts", import.meta.url), "utf8");
  for (const source of [region, search, recommendations, verlauf]) {
    assert.equal(source.includes("hit-id"), false);
    assert.equal(source.includes("{hit.geoKey ?? hit.id}"), false);
    assert.equal(source.includes("<span className=\"hit-id\">"), false);
    assert.equal(source.includes("{saved.geoKey"), false);
    assert.equal(source.includes("{item.location.geoKey}"), false);
  }
  assert.equal(recModel.includes("item.location.geoKey"), false);
});

test("parent name renders only from parentLabel when it is a non-empty string", () => {
  assert.equal(catalogParentName({ parentLabel: "Leipzig" }), "Leipzig");
  assert.equal(catalogParentName({ parentLabel: "  Leipzig  " }), "Leipzig");
  assert.equal(catalogParentName({ parentLabel: "Leipzig", parentName: "ignored" }), "Leipzig");
  assert.equal(catalogParentName({ parentLabel: "" }), null);
  assert.equal(catalogParentName({ parentLabel: "   " }), null);
  assert.equal(catalogParentName({ parentLabel: null }), null);
  assert.equal(catalogParentName({ label: "Plagwitz", parentName: "Leipzig" }), null);
  assert.equal(catalogParentName({ municipalityName: "Leipzig", gemeinde: "Leipzig" }), null);
  assert.equal(catalogParentName({ parentMunicipality: "Leipzig", gemeindeName: "Leipzig" }), null);
  assert.equal(catalogParentName({ parent: "Leipzig", municipality: "Leipzig" }), null);
});

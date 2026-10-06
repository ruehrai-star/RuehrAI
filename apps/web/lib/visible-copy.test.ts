import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { catalogHitVisibleText, catalogPlaceName, containsInternalKey, unnamedPlaceLabel, visiblePlaceText } from "./format.ts";
import { hitName } from "./recommendations/model.ts";
import { runRegionEntryLabel } from "./analysis/run-label.ts";
import type { Recommendation } from "./api/types.ts";

const KEY_SAMPLES = [
  "stadtteil:osm:2613711",
  "ortsteil:osm:162894",
  "lor:plr:07400823",
  "koeln:sq:12",
  "other:lor:plr:07400823",
];

function rec(partial: Partial<Recommendation> & Pick<Recommendation, "id">): Recommendation {
  return {
    rank: 1,
    title: partial.title ?? partial.id,
    score: 0.5,
    rationale: "Begründung.",
    source: "heuristic",
    criteriaEvidence: [],
    location: {
      geoKey: partial.location?.geoKey ?? partial.id,
      grain: partial.location?.grain ?? "other",
      lon: null,
      lat: null,
      name: partial.location?.name ?? null,
    },
    kind: partial.kind,
    name: partial.name ?? null,
    parentLabel: partial.parentLabel ?? null,
    ...partial,
  };
}

test("visible helpers strip catalog keys and parenthesized ids", () => {
  assert.equal(visiblePlaceText("Altstadt-Nord (stadtteil:osm:2613711)"), "Altstadt-Nord");
  assert.equal(visiblePlaceText("Tempelhof (ortsteil:osm:162894)"), "Tempelhof");
  assert.equal(visiblePlaceText("LOR Rathaus Tempelhof (07400927)", "lor:plr:07400927"), "LOR Rathaus Tempelhof");
  assert.equal(visiblePlaceText("lor:plr:07400823"), "");
  assert.equal(visiblePlaceText("stadtteil:osm:2613711"), "");
  assert.equal(catalogPlaceName({ label: "Innenstadt (stadtteil:osm:2613711)", geoKey: "stadtteil:osm:2613711" }), "Innenstadt");
  assert.equal(runRegionEntryLabel({ label: "Tempelhof (ortsteil:osm:162894)", geoKey: "ortsteil:osm:162894", parentLabel: "Berlin" }), "Tempelhof (Berlin)");
});

test("unnamed LOR and Köln hits use the kind sentence, never the key", () => {
  const lor = rec({ id: "other:lor:plr:07400823", kind: "lor", name: null, title: "lor:plr:07400823", location: { geoKey: "lor:plr:07400823", grain: "other", lon: null, lat: null, name: null } });
  const quartier = rec({ id: "koeln:sq:12", kind: "quartier", name: null, title: "koeln:sq:12", location: { geoKey: "koeln:sq:12", grain: "other", lon: null, lat: null, name: null } });
  assert.equal(hitName(lor), "Planungsraum ohne Namen");
  assert.equal(hitName(quartier), "Quartier ohne Namen");
  assert.equal(unnamedPlaceLabel({ kind: "ortsteil" }), "Ortsteil ohne Namen");
  for (const key of KEY_SAMPLES) {
    assert.equal(hitName(lor).includes(key), false);
    assert.equal(hitName(quartier).includes(key), false);
  }
});

test("rendered copy for search, Stand, heading, hits, and Musterprofil has no internal keys", () => {
  const sources = [
    catalogHitVisibleText({
      label: "Altstadt-Nord (stadtteil:osm:2613711)",
      geoKey: "stadtteil:osm:2613711",
      level: "stadtteil",
      parentLabel: "Köln",
    }),
    catalogPlaceName({ label: "LOR Rathaus Tempelhof (07400927)", geoKey: "lor:plr:07400927" }) ?? "",
    runRegionEntryLabel({ label: "Tempelhof", geoKey: "ortsteil:osm:162894", parentLabel: "Berlin" }),
    hitName(rec({ id: "other:lor:plr:07400823", kind: "lor", name: null, title: "lor:plr:07400823" })),
    hitName(rec({ id: "plz5:10965", kind: "plz", name: "10965", title: "10965", location: { geoKey: "plz5:10965", grain: "plz5", lon: null, lat: null, name: "10965" } })),
  ];
  for (const text of sources) {
    assert.equal(containsInternalKey(text), false, text);
    for (const key of ["lor:plr:", "koeln:sq:", "stadtteil:osm:", "ortsteil:osm:"]) {
      assert.equal(text.includes(key), false, `${text} leaked ${key}`);
    }
  }
});

test("pages do not interpolate geoKey or catalog id as visible text", () => {
  const files = [
    "components/region-section.tsx",
    "components/search-panel.tsx",
    "components/empfehlungen-page.tsx",
    "components/verlauf-page.tsx",
    "components/musteranalyse-page.tsx",
    "components/map-view.tsx",
    "components/catalog-hit-label.tsx",
  ];
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.equal(source.includes("{hit.geoKey"), false, file);
    assert.equal(source.includes("{item.location.geoKey}"), false, file);
    assert.equal(source.includes("{saved.geoKey"), false, file);
  }
});

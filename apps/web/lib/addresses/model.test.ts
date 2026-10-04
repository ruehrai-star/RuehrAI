import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  ADDRESS_COPY,
  addressPageView,
  canEvaluate,
  emptyAddressPageState,
  inputHint,
  presentSharedFromSides,
  reduceAddressPage,
  topicLabel,
  zensus2022Cells,
} from "./model.ts";
import type { AddressInput, AddressPairResult, AddressSide, AddressTopic } from "./types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const valid: AddressInput = { street: "Marienplatz 1", postalCode: "80331", city: "München" };
const other: AddressInput = { street: "Sendlinger Str. 2", postalCode: "80331", city: "München" };
const berlin: AddressInput = { street: "Alexanderplatz 1", postalCode: "10178", city: "Berlin" };

const forbidden = [
  "Ortsteil",
  "Bezirk",
  "Hausnummer",
  "Gitter",
  "Wetter",
  "Luft",
  "plz8",
  "Verlauf",
  "Empfehlung",
] as const;

test("UX labels for Adressen stay exact", () => {
  assert.equal(ADDRESS_COPY.nav, "Adressen");
  assert.equal(ADDRESS_COPY.title, "Adressen");
  assert.equal(ADDRESS_COPY.leftTitle, "Adresse 1");
  assert.equal(ADDRESS_COPY.rightTitle, "Adresse 2");
  assert.equal(ADDRESS_COPY.street, "Straße");
  assert.equal(ADDRESS_COPY.postalCode, "PLZ");
  assert.equal(ADDRESS_COPY.city, "Stadt");
  assert.equal(ADDRESS_COPY.evaluate, "Auswerten");
  assert.equal(ADDRESS_COPY.running, "Auswertung läuft …");
  assert.equal(ADDRESS_COPY.failed, "Auswertung fehlgeschlagen.");
  assert.equal(ADDRESS_COPY.sameAddress, "Beide Eingaben sind dieselbe Adresse.");
  assert.equal(ADDRESS_COPY.samePlz, "Beide Adressen liegen in derselben PLZ. Die Zahlen sind dieselben.");
  assert.equal(ADDRESS_COPY.absent, "liegt nicht vor");
  assert.equal(ADDRESS_COPY.sharedEmpty, "Keine gemeinsamen Parameter.");
  assert.equal(ADDRESS_COPY.unknownResolution, "Die PLZ löst nicht genau eine Gemeinde und einen Kreis auf.");
});

test("Auswerten stays inactive until all six fields are valid", () => {
  assert.equal(canEvaluate(valid, berlin), true);
  assert.equal(canEvaluate({ ...valid, street: "  " }, berlin), false);
  assert.equal(canEvaluate({ ...valid, city: "" }, berlin), false);
  assert.equal(canEvaluate({ ...valid, postalCode: "8033" }, berlin), false);
  assert.equal(canEvaluate({ ...valid, postalCode: "8033a" }, berlin), false);
  assert.equal(canEvaluate({ ...valid, postalCode: "803311" }, berlin), false);
  assert.equal(canEvaluate(valid, { ...berlin, street: "" }), false);
  assert.equal(canEvaluate(valid, { ...berlin, city: " " }), false);
  assert.equal(canEvaluate(valid, { ...berlin, postalCode: "1017" }), false);
  const view = addressPageView({
    ...emptyAddressPageState(),
    left: { street: "Marienplatz 1", postalCode: "80331", city: "" },
    right: berlin,
  });
  assert.equal(view.canEvaluate, false);
});

test("the two same-input hints follow the UX wording", () => {
  assert.equal(inputHint(valid, { ...valid }), ADDRESS_COPY.sameAddress);
  assert.equal(inputHint(valid, other), ADDRESS_COPY.samePlz);
  assert.equal(inputHint(valid, berlin), null);
  assert.equal(inputHint({ ...valid, city: "" }, { ...valid, city: "" }), null);
  const same = addressPageView({ ...emptyAddressPageState(), left: valid, right: { ...valid } });
  assert.equal(same.hint, "Beide Eingaben sind dieselbe Adresse.");
  const samePlz = addressPageView({ ...emptyAddressPageState(), left: valid, right: other });
  assert.equal(samePlz.hint, "Beide Adressen liegen in derselben PLZ. Die Zahlen sind dieselben.");
});

test("changing a field clears the last result and the failed state", () => {
  const withResult = reduceAddressPage(emptyAddressPageState(), {
    type: "success",
    result: pairResult({ left: resolvedSide(valid), right: resolvedSide(berlin) }),
  });
  assert.ok(withResult.result);
  const cleared = reduceAddressPage(withResult, {
    type: "change",
    side: "left",
    field: "street",
    value: "Kaufingerstraße 1",
  });
  assert.equal(cleared.result, null);
  assert.equal(cleared.failed, false);
  assert.equal(addressPageView(cleared).showResult, false);
  assert.equal(addressPageView(cleared).left, null);
  assert.equal(addressPageView(cleared).right, null);

  const failed = reduceAddressPage(emptyAddressPageState(), { type: "failure" });
  const afterFailChange = reduceAddressPage(failed, {
    type: "change",
    side: "right",
    field: "city",
    value: "Hamburg",
  });
  assert.equal(afterFailChange.failed, false);
  assert.equal(addressPageView(afterFailChange).failedText, null);
});

test("absent topics show liegt nicht vor and never a 0 stand-in", () => {
  const result = pairResult({
    left: resolvedSide(valid, [
      present("pendler", "gemeinde", { count: 12 }),
      absent("breitband", "gemeinde"),
      absent("zensus2022", "gemeinde"),
    ]),
    right: resolvedSide(berlin, [absent("pendler", "gemeinde")]),
  });
  const view = addressPageView({ ...emptyAddressPageState(), left: valid, right: berlin, result });
  const breitband = view.left?.sections[0]?.rows.find((row) => row.id === "breitband");
  const zensus = view.left?.sections[0]?.rows.find((row) => row.id === "zensus2022");
  assert.equal(breitband?.present, false);
  assert.equal(breitband?.absentText, "liegt nicht vor");
  assert.deepEqual(breitband?.cells, []);
  assert.equal(zensus?.absentText, "liegt nicht vor");
  assert.deepEqual(zensus?.cells, []);
  assert.equal(
    view.left?.sections.flatMap((section) => section.rows).some((row) => !row.present && row.cells.some((cell) => cell.text === "0")),
    false,
  );
  assert.equal(view.visibleText.includes("liegt nicht vor"), true);
});

test("a present zensus2022 row shows Gebäude and Wohnungen and omits a missing cell instead of 0", () => {
  assert.deepEqual(zensus2022Cells({ gebaeude: 1840, wohnungen: 2210 }), [
    { label: "Gebäude", text: "1.840" },
    { label: "Wohnungen", text: "2.210" },
  ]);
  const onlyBuildings = zensus2022Cells({ gebaeude: 1840 });
  assert.deepEqual(onlyBuildings, [{ label: "Gebäude", text: "1.840" }]);
  assert.equal(
    onlyBuildings.some((cell) => cell.label === "Wohnungen"),
    false,
  );
  assert.equal(
    onlyBuildings.some((cell) => cell.text === "0"),
    false,
  );
  const onlyDwellings = zensus2022Cells({ wohnungen: 2210 });
  assert.deepEqual(onlyDwellings, [{ label: "Wohnungen", text: "2.210" }]);
  assert.equal(
    onlyDwellings.some((cell) => cell.label === "Gebäude"),
    false,
  );

  const result = pairResult({
    left: resolvedSide(valid, [present("zensus2022", "gemeinde", { gebaeude: 1840 })]),
    right: resolvedSide(berlin, [present("zensus2022", "gemeinde", { gebaeude: 900, wohnungen: 1100 })]),
  });
  const view = addressPageView({ ...emptyAddressPageState(), left: valid, right: berlin, result });
  const leftZensus = view.left?.sections[0]?.rows.find((row) => row.id === "zensus2022");
  const rightZensus = view.right?.sections[0]?.rows.find((row) => row.id === "zensus2022");
  assert.equal(leftZensus?.label, "Zensus 2022");
  assert.deepEqual(
    leftZensus?.cells.map((cell) => cell.label),
    ["Gebäude"],
  );
  assert.equal(
    leftZensus?.cells.some((cell) => cell.label === "Wohnungen" || cell.text === "0"),
    false,
  );
  assert.deepEqual(
    rightZensus?.cells.map((cell) => `${cell.label}:${cell.text}`),
    ["Gebäude:900", "Wohnungen:1.100"],
  );
});

test("Gemeinsam lists only topics present on both sides", () => {
  const left = resolvedSide(valid, [
    present("pendler", "gemeinde", { count: 10 }),
    present("pks", "kreis", { cases: 3 }),
    absent("breitband", "gemeinde"),
  ]);
  const right = resolvedSide(berlin, [
    present("pendler", "gemeinde", { count: 4 }),
    absent("pks", "kreis"),
    present("breitband", "gemeinde", { rate: 0.9 }),
  ]);
  assert.deepEqual(
    presentSharedFromSides(left, right).map((row) => `${row.level}:${row.id}`),
    ["gemeinde:pendler"],
  );
  const view = addressPageView({
    ...emptyAddressPageState(),
    left: valid,
    right: berlin,
    result: pairResult({ left, right, shared: [{ id: "breitband", level: "gemeinde", left: null, right: { rate: 0.9 } }] }),
  });
  assert.deepEqual(
    view.sharedRows.map((row) => row.label),
    ["Pendler · Gemeinde"],
  );
  assert.equal(view.sharedEmpty, false);
  assert.ok(view.sharedRows[0]);
  assert.notEqual(JSON.stringify(view.sharedRows[0].left), JSON.stringify(view.sharedRows[0].right));
});

test("Gemeinsam is empty when nothing is present on both sides", () => {
  const view = addressPageView({
    ...emptyAddressPageState(),
    left: valid,
    right: berlin,
    result: pairResult({
      left: resolvedSide(valid, [absent("pendler", "gemeinde")]),
      right: resolvedSide(berlin, [present("pendler", "gemeinde", { count: 1 })]),
    }),
  });
  assert.deepEqual(view.sharedRows, []);
  assert.equal(view.sharedEmpty, true);
  assert.equal(view.sharedEmptyText, "Keine gemeinsamen Parameter.");
});

test("Gemeinde, Kreis and Land rows stay in the UX order", () => {
  const view = addressPageView({
    ...emptyAddressPageState(),
    left: valid,
    right: berlin,
    result: pairResult({ left: resolvedSide(valid), right: resolvedSide(berlin) }),
  });
  assert.deepEqual(
    view.left?.sections.find((section) => section.level === "gemeinde")?.rows.map((row) => row.id),
    [
      "pendler",
      "breitband",
      "bundestagswahl",
      "gerda",
      "gemeindeverzeichnis",
      "zensus2022",
      "bevoelkerung",
      "wanderungen",
      "unfallatlas",
      "rwi-redx",
      "wwk",
      "boris",
      "pks",
      "open-nrw",
    ],
  );
  assert.deepEqual(
    view.left?.sections.find((section) => section.level === "kreis")?.rows.map((row) => row.id),
    ["pks", "destatis", "vgrdl", "pendler", "unfallatlas", "arbeitsmarkt"],
  );
  assert.deepEqual(
    view.left?.sections.find((section) => section.level === "land")?.rows.map((row) => row.id),
    ["pendler", "dehoga", "kba", "baugenehmigungen", "kmk"],
  );
});

test("Pendler, PKS and Unfallatlas name the level on the row", () => {
  assert.equal(topicLabel("pendler", "gemeinde"), "Pendler · Gemeinde");
  assert.equal(topicLabel("pendler", "kreis"), "Pendler · Kreis");
  assert.equal(topicLabel("pendler", "land"), "Pendler · Land");
  assert.equal(topicLabel("pks", "gemeinde"), "PKS · Gemeinde");
  assert.equal(topicLabel("pks", "kreis"), "PKS · Kreis");
  assert.equal(topicLabel("unfallatlas", "gemeinde"), "Unfallatlas · Gemeinde");
  assert.equal(topicLabel("unfallatlas", "kreis"), "Unfallatlas · Kreis");
  assert.equal(topicLabel("breitband", "gemeinde"), "Breitband");
  assert.equal(topicLabel("arbeitsmarkt", "kreis"), "Arbeitsmarkt");
});

test("unknown resolution shows a factual line and no topic rows", () => {
  const view = addressPageView({
    ...emptyAddressPageState(),
    left: valid,
    right: berlin,
    result: pairResult({
      left: {
        input: valid,
        resolution: "unknown",
        gemeinde: null,
        kreis: null,
        land: null,
        topics: [present("pendler", "gemeinde", { count: 1 })],
      },
      right: resolvedSide(berlin),
    }),
  });
  assert.equal(view.left?.resolutionUnknown, true);
  assert.equal(view.left?.unknownText, ADDRESS_COPY.unknownResolution);
  assert.deepEqual(view.left?.sections, []);
  assert.equal(view.left?.gemeinde, null);
  assert.equal(view.left?.kreis, null);
  assert.ok((view.right?.sections.length ?? 0) > 0);
});

test("a Kreis id outside the named list is shown as the id", () => {
  const view = addressPageView({
    ...emptyAddressPageState(),
    left: valid,
    right: berlin,
    result: pairResult({
      left: resolvedSide(valid, [present("statistik-bw", "kreis", { files: 2 })]),
      right: resolvedSide(berlin),
    }),
  });
  const extra = view.left?.sections.find((section) => section.level === "kreis")?.rows.find((row) => row.id === "statistik-bw");
  assert.equal(extra?.label, "statistik-bw");
  assert.equal(extra?.present, true);
});

test("failed evaluation shows the exact sentence and no parameters", () => {
  const view = addressPageView({
    ...emptyAddressPageState(),
    left: valid,
    right: berlin,
    failed: true,
  });
  assert.equal(view.failedText, "Auswertung fehlgeschlagen.");
  assert.equal(view.showResult, false);
  assert.equal(view.left, null);
  assert.equal(view.sharedEmptyText, null);
  assert.equal(view.canEvaluate, true);
});

test("a running request keeps Auswerten inactive and shows the running line", () => {
  let state = reduceAddressPage({ ...emptyAddressPageState(), left: valid, right: berlin }, { type: "submit" });
  assert.equal(state.running, true);
  assert.equal(state.result, null);
  const view = addressPageView(state);
  assert.equal(view.runningText, "Auswertung läuft …");
  assert.equal(view.canEvaluate, false);
  state = reduceAddressPage(state, { type: "submit" });
  assert.equal(state.running, true);
});

test("Ortsteil, Bezirk, Hausnummer, Gitter, Wetter, Luft, map, Verlauf and Empfehlung stay off this page", () => {
  const result = pairResult({
    left: resolvedSide(valid, [present("pendler", "gemeinde", { count: 2 }), present("zensus2022", "gemeinde", { gebaeude: 1, wohnungen: 2 })]),
    right: resolvedSide(berlin, [present("pendler", "gemeinde", { count: 5 })]),
  });
  const view = addressPageView({ ...emptyAddressPageState(), left: valid, right: berlin, result });
  for (const term of forbidden) {
    assert.equal(view.visibleText.includes(term), false, term);
  }
  assert.equal(/karte/i.test(view.visibleText), false);

  const production = [
    "lib/addresses/api.ts",
    "lib/addresses/model.ts",
    "lib/addresses/parse.ts",
    "lib/addresses/types.ts",
    "components/adressen-page.tsx",
    "app/adressen/page.tsx",
  ];
  for (const file of production) {
    const source = readFileSync(join(root, file), "utf8");
    for (const term of forbidden) {
      assert.equal(source.includes(term), false, `${file} ${term}`);
    }
    assert.equal(source.includes("MapView"), false, file);
    assert.equal(source.includes("map-canvas"), false, file);
    assert.equal(source.includes("maplibre"), false, file);
  }

  const header = readFileSync(join(root, "components/app-header.tsx"), "utf8");
  assert.match(header, /href: "\/adressen", label: "Adressen"/);
});

function present(id: string, level: AddressTopic["level"], value: unknown): AddressTopic {
  return { id, level, status: "present", value };
}

function absent(id: string, level: AddressTopic["level"]): AddressTopic {
  return { id, level, status: "absent" };
}

function resolvedSide(input: AddressInput, topics: AddressTopic[] = []): AddressSide {
  return {
    input,
    resolution: "resolved",
    gemeinde: { name: input.city },
    kreis: { name: `${input.city}-Kreis` },
    land: { name: "Bayern" },
    topics,
  };
}

function pairResult(parts: {
  left: AddressSide;
  right: AddressSide;
  shared?: AddressPairResult["shared"];
}): AddressPairResult {
  return { left: parts.left, right: parts.right, shared: parts.shared ?? [] };
}

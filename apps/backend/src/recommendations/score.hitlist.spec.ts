import { PatternCriterion } from "../analysis/types";
import { buildPatternByDataset } from "../analysis/pattern-profile";
import { SeriesLevel, YearlySeries } from "../analysis/yearly-series";
import { AreaCandidate, AreaKind, selectCatalogHits } from "./area-candidates";
import { rankTeilflaechen } from "./score";

function candidate(overrides: Partial<AreaCandidate> & Pick<AreaCandidate, "geoKey" | "kind">): AreaCandidate {
  const grain = overrides.grain ?? (overrides.kind === "plz" ? "plz5" : "other");
  return {
    id: `${grain}:${overrides.geoKey}`,
    title: overrides.title ?? overrides.geoKey,
    name: overrides.name ?? overrides.title ?? overrides.geoKey,
    ags: overrides.ags ?? "11000000",
    plz: overrides.plz ?? null,
    lon: overrides.lon ?? 13.4,
    lat: overrides.lat ?? 52.5,
    grain,
    ...overrides,
  };
}

function series(overrides: Partial<YearlySeries> & Pick<YearlySeries, "metricId" | "requestedGeoKey">): YearlySeries {
  return {
    requestedLevel: "ortsteil",
    sourceLevel: "ortsteil",
    sourceGeoKey: overrides.requestedGeoKey,
    granularity: "year",
    coverage: "multi",
    points: [
      { period: "2023", status: "present", value: 10 },
      { period: "2024", status: "present", value: 12 },
      { period: "2025", status: "present", value: 14 },
    ],
    ...overrides,
  };
}

function inhabitants(geoKey: string, level: SeriesLevel = "ortsteil", value = 10_000): YearlySeries {
  return series({
    metricId: "bevoelkerung",
    requestedGeoKey: geoKey,
    requestedLevel: level,
    sourceLevel: level,
    sourceGeoKey: geoKey,
    points: [
      { period: "2023", status: "present", value },
      { period: "2024", status: "present", value },
      { period: "2025", status: "present", value },
    ],
  });
}

function localUnfall(geoKey: string, first: number, last: number, level: SeriesLevel = "ortsteil"): YearlySeries {
  return series({
    metricId: "unfallatlas",
    requestedGeoKey: geoKey,
    requestedLevel: level,
    sourceLevel: level,
    sourceGeoKey: geoKey,
    points: [
      { period: "2023", status: "present", value: first },
      { period: "2025", status: "present", value: last },
    ],
  });
}

function inherited(
  geoKey: string,
  metricId: string,
  level: SeriesLevel,
  sourceGeoKey: string,
): YearlySeries {
  return series({
    metricId,
    requestedGeoKey: geoKey,
    requestedLevel: "ortsteil",
    sourceLevel: level,
    sourceGeoKey,
    points: [
      { period: "2023", status: "present", value: 20 },
      { period: "2025", status: "present", value: 18 },
    ],
  });
}

const koelnAgs = "05315000";
const berlinAgs = "11000000";

const pattern: PatternCriterion[] = [
  {
    key: "unfallatlas",
    metricId: "unfallatlas",
    label: "Unfälle",
    direction: "up",
    evidence: "steigt",
    kind: "trend",
    coverage: "multi",
    baseline: "per_1000_inhabitants",
  },
  {
    key: "wanderungen",
    metricId: "wanderungen",
    label: "Wanderungen",
    direction: "down",
    evidence: "fällt",
    kind: "trend",
    coverage: "multi",
    baseline: "per_1000_inhabitants",
  },
  {
    key: "destatis_bevoelkerung_alter",
    metricId: "destatis_bevoelkerung_alter",
    label: "Bevölkerung nach Alter",
    direction: "flat",
    evidence: "unverändert",
    kind: "trend",
    coverage: "multi",
    baseline: "per_1000_inhabitants",
  },
];

const koelnInnenstadt = {
  geoKey: "stadtbezirk:osm:2613798",
  grain: "other" as const,
  ags: koelnAgs,
  plz: null,
};

const tempelhof = {
  geoKey: "ortsteil:osm:162894",
  grain: "other" as const,
  ags: berlinAgs,
  plz: null,
};

const lichterfelde = {
  geoKey: "ortsteil:osm:55737",
  grain: "other" as const,
  ags: berlinAgs,
  plz: null,
};

const koelnOrtsteile = [
  "Altstadt-Nord",
  "Altstadt-Süd",
  "Deutz",
  "Neustadt-Nord",
  "Neustadt-Süd",
].map((title, index) =>
  candidate({ geoKey: `ortsteil:osm:koeln-${index + 1}`, kind: "ortsteil", title, ags: koelnAgs }),
);

function nOf(kind: AreaKind, count: number, prefix: string, ags: string): AreaCandidate[] {
  return Array.from({ length: count }, (_, index) =>
    candidate({
      geoKey: `${prefix}${String(index + 1).padStart(2, "0")}`,
      kind,
      grain: kind === "plz" ? "plz5" : "other",
      title: `${kind} ${index + 1}`,
      ags,
      plz: kind === "plz" ? `${prefix}${String(index + 1).padStart(2, "0")}` : null,
    }),
  );
}

describe("Trefferliste fixtures (Köln Innenstadt, Tempelhof, Lichterfelde)", () => {
  it("ranks Köln Innenstadt Ortsteile with Unfallatlas and baseline to at least one hit", () => {
    const quartiere = nOf("quartier", 3, "koeln:sq:", koelnAgs);
    const parent = candidate({
      geoKey: koelnInnenstadt.geoKey,
      kind: "stadtbezirk",
      title: "Innenstadt",
      ags: koelnAgs,
    });
    const loaded = selectCatalogHits([...koelnOrtsteile, ...quartiere, parent], [koelnInnenstadt]);
    const yearly: YearlySeries[] = [];
    koelnOrtsteile.forEach((item, index) => {
      yearly.push(localUnfall(item.geoKey, 8 + index * 4, 20 - index * 3), inhabitants(item.geoKey));
      yearly.push(inherited(item.geoKey, "wanderungen", "gemeinde", koelnAgs));
      yearly.push(inherited(item.geoKey, "destatis_bevoelkerung_alter", "kreis", "05315"));
    });
    const ranked = rankTeilflaechen(loaded, yearly, pattern, [], {
      patternByDataset: buildPatternByDataset([
        localUnfall(koelnOrtsteile[0]!.geoKey, 8, 20),
        inhabitants(koelnOrtsteile[0]!.geoKey),
      ]),
    });
    expect(ranked.length).toBeGreaterThanOrEqual(1);
    expect(ranked).toHaveLength(5);
    expect(ranked.every((item) => item.kind === "ortsteil")).toBe(true);
    expect(ranked.some((item) => item.score > 0)).toBe(true);
    expect(ranked.map((item) => item.location.geoKey)).not.toContain(koelnInnenstadt.geoKey);
    expect(ranked.map((item) => item.kind)).not.toContain("stadtbezirk");
  });

  it("lists Tempelhof PLR when Unfallatlas is missing locally and Gemeinde/Kreis are inherited", () => {
    const plr = nOf("lor", 9, "lor:plr:tempelhof:", berlinAgs);
    const bzr = nOf("bezirk", 4, "lor:bzr:tempelhof:", berlinAgs);
    const plz = nOf("plz", 7, "1209", berlinAgs);
    const parent = candidate({
      geoKey: tempelhof.geoKey,
      kind: "ortsteil",
      title: "Tempelhof",
      ags: berlinAgs,
    });
    expect(plr.length + bzr.length + plz.length).toBe(20);
    const loaded = selectCatalogHits([...plr, ...bzr, ...plz, parent], [tempelhof]);
    const yearly: YearlySeries[] = [];
    for (const item of plr) {
      yearly.push(inhabitants(item.geoKey, "lor"));
      yearly.push(inherited(item.geoKey, "wanderungen", "gemeinde", berlinAgs));
      yearly.push(inherited(item.geoKey, "destatis_bevoelkerung_alter", "kreis", "11000"));
    }
    const ranked = rankTeilflaechen(loaded, yearly, pattern);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.every((item) => item.kind === "lor")).toBe(true);
    expect(ranked).toHaveLength(9);
    expect(ranked.every((item) => item.score === 0)).toBe(true);
    expect(ranked[0]?.criteriaEvidence.find((entry) => entry.key === "unfallatlas")?.evidence).toMatch(/liegt nicht vor/);
    expect(ranked[0]?.criteriaEvidence.find((entry) => entry.key === "wanderungen")?.scope).toBe("inherited");
    expect(ranked.map((item) => item.location.geoKey)).not.toContain(tempelhof.geoKey);
    expect(ranked.map((item) => item.kind)).not.toContain("ortsteil");
    expect(ranked.map((item) => item.kind)).not.toContain("bezirk");
  });

  it("lists Lichterfelde Teilflächen instead of an empty hit list", () => {
    const plr = nOf("lor", 12, "lor:plr:lichterfelde:", berlinAgs);
    const bzr = nOf("bezirk", 2, "lor:bzr:lichterfelde:", berlinAgs);
    const plz = nOf("plz", 10, "1220", berlinAgs);
    expect(plr.length + bzr.length + plz.length).toBe(24);
    const loaded = selectCatalogHits([...plr, ...bzr, ...plz], [lichterfelde]);
    const yearly: YearlySeries[] = [];
    for (const item of plr) {
      yearly.push(inhabitants(item.geoKey, "lor"));
    }
    const ranked = rankTeilflaechen(loaded, yearly, pattern);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked).toHaveLength(12);
    expect(ranked.every((item) => item.kind === "lor")).toBe(true);
    expect(ranked.map((item) => item.location.geoKey)).not.toContain(lichterfelde.geoKey);
  });

  it("does not drop siblings when Gemeinde/Kreis criteria are inherited", () => {
    const siblings = [
      candidate({ geoKey: "lor:plr:a", kind: "lor", title: "PLR A", ags: berlinAgs }),
      candidate({ geoKey: "lor:plr:b", kind: "lor", title: "PLR B", ags: berlinAgs }),
    ];
    const ranked = rankTeilflaechen(
      siblings,
      [
        inhabitants("lor:plr:a", "lor"),
        inhabitants("lor:plr:b", "lor"),
        inherited("lor:plr:a", "wanderungen", "gemeinde", berlinAgs),
        inherited("lor:plr:b", "wanderungen", "gemeinde", berlinAgs),
        inherited("lor:plr:a", "destatis_bevoelkerung_alter", "kreis", "11000"),
        inherited("lor:plr:b", "destatis_bevoelkerung_alter", "kreis", "11000"),
      ],
      pattern,
    );
    expect(ranked.map((item) => item.title).sort()).toEqual(["PLR A", "PLR B"]);
    expect(ranked.every((item) => item.criteriaEvidence.find((entry) => entry.key === "wanderungen")?.match === false)).toBe(
      true,
    );
    expect(ranked.every((item) => item.criteriaEvidence.find((entry) => entry.key === "wanderungen")?.scope === "inherited")).toBe(
      true,
    );
  });
});

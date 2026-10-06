import { baselineForMetric } from "../analysis/series-baseline";
import { PatternCriterion } from "../analysis/types";
import { YearlySeries } from "../analysis/yearly-series";
import { AreaCandidate } from "./area-candidates";
import {
  extractLooFixtureFromPayload,
  valueKeyForBaselineMatch,
  withFixtureValueKeyHygiene,
} from "./score-loo-fixture";
import { RecommendationItem, RecommendationPayload } from "./types";

const perKm2: PatternCriterion = {
  key: "unfallatlas",
  metricId: "unfallatlas",
  label: "Unfälle",
  direction: "down",
  evidence: "fällt",
  kind: "trend",
  coverage: "multi",
  baseline: "per_km2",
};

function series(geoKey: string, valueKey?: string): YearlySeries {
  return {
    metricId: "unfallatlas",
    requestedLevel: "lor",
    requestedGeoKey: geoKey,
    sourceLevel: "lor",
    sourceGeoKey: geoKey,
    granularity: "year",
    coverage: "multi",
    ...(valueKey ? { valueKey } : {}),
    points: [
      { period: "2023", status: "present", value: 2.1 },
      { period: "2025", status: "present", value: 1.4 },
    ],
  };
}

function candidate(geoKey: string): AreaCandidate {
  return {
    id: `other:${geoKey}`,
    geoKey,
    grain: "other",
    kind: "lor",
    title: geoKey,
    name: geoKey,
    ags: "11000000",
    plz: null,
    lon: 13.3,
    lat: 52.4,
    targetRegionGeoKey: "ortsteil:osm:a",
  };
}

function item(geoKey: string): RecommendationItem {
  return {
    id: `other:${geoKey}`,
    rank: 1,
    rationale: "x",
    source: "heuristic",
    title: "Planungsraum",
    kind: "lor",
    grain: "other",
    name: "Planungsraum",
    parentLabel: null,
    targetRegionGeoKey: "ortsteil:osm:a",
    dataAsOf: "2025",
    location: { geoKey, grain: "other", lon: 13.3, lat: 52.4, name: "Planungsraum" },
    score: 0.1,
    criteriaEvidence: [
      {
        key: "unfallatlas",
        metricId: "unfallatlas",
        label: "Unfälle",
        direction: "down",
        patternDirection: "down",
        evidence: "fällt",
        kind: "trend",
        baseline: "per_km2",
        points: [
          { period: "2023", status: "present", value: 2.1 },
          { period: "2025", status: "present", value: 1.4 },
        ],
      },
    ],
  };
}

describe("LOO fixture valueKey hygiene", () => {
  it("infers unfaelle_je_km2 so unfallatlas matches a per_km2 criterion", () => {
    expect(baselineForMetric("unfallatlas")).toBe("per_1000_inhabitants");
    expect(valueKeyForBaselineMatch("unfallatlas", "per_km2")).toBe("unfaelle_je_km2");
    expect(baselineForMetric("unfallatlas", "unfaelle_je_km2")).toBe("per_km2");
  });

  it("sets missing valueKey on fixture yearly reconstructed from evidence", () => {
    const fixed = withFixtureValueKeyHygiene({
      targetRegionGeoKey: "ortsteil:osm:a",
      stores: [
        { geoKey: "lor:plr:1", title: "A" },
        { geoKey: "lor:plr:2", title: "B" },
        { geoKey: "lor:plr:3", title: "C" },
      ],
      pool: [candidate("lor:plr:1"), candidate("lor:plr:2"), candidate("lor:plr:3")],
      yearly: [series("lor:plr:1"), series("lor:plr:2"), series("lor:plr:3")],
      criteria: [perKm2],
    });
    expect(fixed.yearly.every((entry) => entry.valueKey === "unfaelle_je_km2")).toBe(true);
    expect(fixed.yearly.every((entry) => baselineForMetric(entry.metricId, entry.valueKey) === "per_km2")).toBe(true);
  });

  it("preserves a live yearly-series valueKey that already matches", () => {
    const fixed = withFixtureValueKeyHygiene({
      targetRegionGeoKey: "ortsteil:osm:a",
      stores: [
        { geoKey: "lor:plr:1", title: "A" },
        { geoKey: "lor:plr:2", title: "B" },
        { geoKey: "lor:plr:3", title: "C" },
      ],
      pool: [candidate("lor:plr:1")],
      yearly: [series("lor:plr:1", "unfaelle_je_1000_ew")],
      criteria: [perKm2],
    });
    expect(fixed.yearly[0]?.valueKey).toBe("unfaelle_je_1000_ew");
    expect(baselineForMetric("unfallatlas", "unfaelle_je_1000_ew")).toBe("per_km2");
  });

  it("extracts from a recommendation payload without dropping valueKey", () => {
    const payload: RecommendationPayload = {
      runId: "62",
      window: { from: "2023", to: "2025" },
      count: 3,
      reason: null,
      pattern: {
        source: "heuristic",
        summary: "x",
        revenueDirection: "up",
        criteria: [perKm2],
      },
      patternByDataset: [
        {
          metricId: "unfallatlas",
          baseline: "per_km2",
          sourceLevel: "lor",
          sourceGeoKey: "lor:plr:1",
          yearlySeries: series("lor:plr:1", "unfaelle_je_km2"),
          criterion: perKm2,
        },
      ],
      items: [item("lor:plr:1"), item("lor:plr:2"), item("lor:plr:3")],
    };
    const stripped = {
      ...payload,
      items: payload.items.map((hit) => ({
        ...hit,
        criteriaEvidence: hit.criteriaEvidence.map((evidence) => ({ ...evidence })),
      })),
    };
    const extracted = extractLooFixtureFromPayload({
      payload: stripped,
      stores: [
        { geoKey: "lor:plr:1", title: "Filiale 1" },
        { geoKey: "lor:plr:2", title: "Filiale 2" },
        { geoKey: "lor:plr:3", title: "Filiale 3" },
      ],
    });
    const unfall = extracted.yearly.filter((entry) => entry.metricId === "unfallatlas");
    expect(unfall.length).toBeGreaterThan(0);
    expect(unfall.every((entry) => entry.valueKey === "unfaelle_je_km2")).toBe(true);
    expect(extracted.pool.map((entry) => entry.geoKey)).toEqual(["lor:plr:1", "lor:plr:2", "lor:plr:3"]);
  });
});

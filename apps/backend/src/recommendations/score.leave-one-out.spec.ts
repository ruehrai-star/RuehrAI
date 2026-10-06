import { buildPatternByDataset } from "../analysis/pattern-profile";
import { PatternCriterion } from "../analysis/types";
import { YearlySeries } from "../analysis/yearly-series";
import { AreaCandidate } from "./area-candidates";
import { LOO_MIN_STORES, assertEnoughLooStores, evaluateLeaveOneOut, formatLeaveOneOutMarkdown } from "./score-loo";
import { leaveOneOutTopN } from "./score-formula";

function candidate(geoKey: string, title: string): AreaCandidate {
  return {
    id: `other:${geoKey}`,
    geoKey,
    grain: "other",
    kind: "ortsteil",
    title,
    name: title,
    ags: "11000000",
    plz: null,
    lon: 13.4,
    lat: 52.5,
    targetRegionGeoKey: "ortsteil:osm:region",
  };
}

function unfall(geoKey: string, first: number, last: number): YearlySeries {
  return {
    metricId: "unfallatlas",
    requestedLevel: "ortsteil",
    requestedGeoKey: geoKey,
    sourceLevel: "ortsteil",
    sourceGeoKey: geoKey,
    granularity: "year",
    coverage: "multi",
    points: [
      { period: "2023", status: "present", value: first },
      { period: "2024", status: "present", value: (first + last) / 2 },
      { period: "2025", status: "present", value: last },
    ],
  };
}

function inhabitants(geoKey: string): YearlySeries {
  return {
    metricId: "bevoelkerung",
    requestedLevel: "ortsteil",
    requestedGeoKey: geoKey,
    sourceLevel: "ortsteil",
    sourceGeoKey: geoKey,
    granularity: "year",
    coverage: "multi",
    points: [
      { period: "2023", status: "present", value: 10_000 },
      { period: "2024", status: "present", value: 10_000 },
      { period: "2025", status: "present", value: 10_000 },
    ],
  };
}

const criterion: PatternCriterion = {
  key: "unfallatlas",
  metricId: "unfallatlas",
  label: "Unfälle",
  direction: "down",
  evidence: "fällt",
  kind: "trend",
  coverage: "multi",
  baseline: "per_1000_inhabitants",
};

describe("Leave-one-out: Bestandsfilialen in ihrer Region", () => {
  const stores = [
    { geoKey: "ortsteil:osm:store-1", title: "Filiale 1", first: 20, last: 8 },
    { geoKey: "ortsteil:osm:store-2", title: "Filiale 2", first: 19, last: 9 },
    { geoKey: "ortsteil:osm:store-3", title: "Filiale 3", first: 21, last: 7 },
  ];
  const distractors = [
    { geoKey: "ortsteil:osm:far-1", title: "Anders 1", first: 5, last: 28 },
    { geoKey: "ortsteil:osm:far-2", title: "Anders 2", first: 32, last: 40 },
    { geoKey: "ortsteil:osm:far-3", title: "Anders 3", first: 2, last: 2 },
    { geoKey: "ortsteil:osm:far-4", title: "Anders 4", first: 48, last: 12 },
    { geoKey: "ortsteil:osm:far-5", title: "Anders 5", first: 8, last: 30 },
    { geoKey: "ortsteil:osm:far-6", title: "Anders 6", first: 1, last: 35 },
  ];
  const pool = [...stores, ...distractors].map((item) => candidate(item.geoKey, item.title));
  const values = new Map([...stores, ...distractors].map((item) => [item.geoKey, item] as const));
  const yearlyFor = (geoKeys: string[]): YearlySeries[] =>
    geoKeys.flatMap((geoKey) => {
      const item = values.get(geoKey);
      if (!item) return [];
      return [unfall(item.geoKey, item.first, item.last), inhabitants(item.geoKey)];
    });

  it("aborts when fewer than 3 stores", () => {
    expect(LOO_MIN_STORES).toBe(3);
    expect(() => assertEnoughLooStores(stores.slice(0, 2))).toThrow(/mindestens 3/);
  });

  it("places each left-out store area in Top-N (max 3 or upper tenth) of its region", () => {
    const report = evaluateLeaveOneOut({
      stores: stores.map(({ geoKey, title }) => ({ geoKey, title })),
      pool,
      yearlyFor,
      criteria: [criterion],
      targetRegionGeoKey: "ortsteil:osm:region",
    });
    expect(report.passed).toBe(true);
    expect(report.rows).toHaveLength(stores.length);
    expect(report.rows.every((row) => row.rank != null && row.rank <= row.topN)).toBe(true);
    expect(report.rows.every((row) => row.nAktiv >= 1)).toBe(true);
    expect(leaveOneOutTopN(pool.length)).toBe(Math.max(3, Math.ceil(pool.length / 10)));
    expect(formatLeaveOneOutMarkdown(report)).toContain("Filiale 1");
    expect(buildPatternByDataset(yearlyFor([stores[0]!.geoKey, stores[1]!.geoKey])).length).toBeGreaterThan(0);
  });
});

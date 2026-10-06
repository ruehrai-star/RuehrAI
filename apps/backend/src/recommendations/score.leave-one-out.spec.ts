import { buildPatternByDataset } from "../analysis/pattern-profile";
import { PatternCriterion } from "../analysis/types";
import { YearlySeries } from "../analysis/yearly-series";
import { AreaCandidate } from "./area-candidates";
import { rankTeilflaechen } from "./score";
import { leaveOneOutTopN } from "./score-formula";

/** Documented acceptance: left-out store area in Top-N of its region. N = max(3, ceil(n/10)). */
export const LEAVE_ONE_OUT_TOP_N = 3;

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
  const yearlyFor = (items: Array<{ geoKey: string; first: number; last: number }>): YearlySeries[] =>
    items.flatMap((item) => [unfall(item.geoKey, item.first, item.last), inhabitants(item.geoKey)]);

  it("places each left-out store area in Top-N (max 3 or upper tenth) of its region", () => {
    const ranks: Array<{ title: string; rank: number; score: number; nAktiv: number }> = [];
    for (const leftOut of stores) {
      const remaining = stores.filter((item) => item.geoKey !== leftOut.geoKey);
      const patternByDataset = buildPatternByDataset(yearlyFor(remaining));
      const ranked = rankTeilflaechen(pool, yearlyFor([...stores, ...distractors]), [criterion], [], {
        patternByDataset,
      });
      const regionHits = ranked.filter((item) => item.targetRegionGeoKey === "ortsteil:osm:region");
      const index = regionHits.findIndex((item) => item.location.geoKey === leftOut.geoKey);
      expect(index).toBeGreaterThanOrEqual(0);
      const topN = leaveOneOutTopN(regionHits.length);
      expect(index).toBeLessThan(topN);
      const hit = regionHits[index]!;
      ranks.push({
        title: leftOut.title,
        rank: index + 1,
        score: hit.score,
        nAktiv: hit.criteriaEvidence.filter((entry) => typeof entry.proximity === "number").length,
      });
    }
    expect(ranks).toHaveLength(stores.length);
    expect(ranks.every((row) => row.rank <= Math.max(LEAVE_ONE_OUT_TOP_N, Math.ceil(pool.length / 10)))).toBe(true);
    expect(ranks.every((row) => row.nAktiv >= 1)).toBe(true);
  });
});

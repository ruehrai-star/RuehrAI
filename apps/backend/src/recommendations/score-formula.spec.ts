import {
  IQR_TO_SIGMA,
  MAD_TO_SIGMA,
  SCORE_FORMULA_DEFAULTS,
  closeness,
  combineCandidateScore,
  coverageFactor,
  datasetCloseness,
  grainWeight,
  iqr,
  leaveOneOutTopN,
  mad,
  median,
  niveauValue,
  normalizeWeights,
  readScoreFormulaConfig,
  robustSpread,
  trendDelta,
  trendYearCount,
  trendYearSpan,
} from "./score-formula";
import { SeriesPoint } from "../analysis/yearly-series";

describe("score formula primitives", () => {
  it("uses MAD and falls back to IQR; n<3 or spread 0 is neutral", () => {
    expect(MAD_TO_SIGMA).toBe(1.4826);
    expect(IQR_TO_SIGMA).toBe(1.349);
    expect(median([1, 2, 3])).toBe(2);
    expect(mad([1, 2, 3])).toBe(1);
    expect(iqr([0, 1, 2, 3, 4])).toBeGreaterThan(0);
    expect(robustSpread([1, 1, 1])).toBeNull();
    expect(robustSpread([4, 5])).toBeNull();
    expect(robustSpread([1])).toBeNull();
    expect(robustSpread([])).toBeNull();
    const spread = robustSpread([1, 2, 10]);
    expect(spread).toBeCloseTo(mad([1, 2, 10]) * MAD_TO_SIGMA);
    expect(closeness(1, 1, spread!)).toBe(1);
    expect(closeness(10, 1, spread!)).toBeLessThan(1);
    expect(mad([1, 1, 1, 100])).toBe(0);
    expect(iqr([1, 1, 1, 100])).toBeGreaterThan(0);
    expect(robustSpread([1, 1, 1, 100])).toBeCloseTo(iqr([1, 1, 1, 100]) / IQR_TO_SIGMA);
  });

  it("never divides by zero and treats identical values as neutral", () => {
    expect(robustSpread([8, 8, 8, 8])).toBeNull();
    expect(closeness(1, 2, 0)).toBe(0);
  });

  it("does not count coverage single as a trend", () => {
    const twoYears: SeriesPoint[] = [
      { period: "2023", status: "present", value: 10, normalizedValue: 1 },
      { period: "2025", status: "present", value: 20, normalizedValue: 2 },
    ];
    expect(trendDelta(twoYears, "multi")).toBe(0.5);
    expect(trendDelta(twoYears, "series")).toBe(0.5);
    expect(trendYearSpan(twoYears, "multi")).toBe(2);
    expect(trendYearCount(twoYears, "multi")).toBe(2);
    expect(trendDelta(twoYears, "single")).toBeNull();
    expect(trendDelta(twoYears, "none")).toBeNull();
    expect(trendDelta([{ period: "2024", status: "present", value: 10, normalizedValue: 1 }], "multi")).toBeNull();
    expect(niveauValue(twoYears)).toBe(2);
    expect(niveauValue([{ period: "2024", status: "absent" }])).toBeNull();
  });

  it("annualizes the trend so a gap does not inflate the delta", () => {
    const withGap: SeriesPoint[] = [
      { period: "2023", status: "present", value: 20, normalizedValue: 2 },
      { period: "2024", status: "absent" },
      { period: "2025", status: "present", value: 8, normalizedValue: 0.8 },
    ];
    const consecutive: SeriesPoint[] = [
      { period: "2024", status: "present", value: 20, normalizedValue: 2 },
      { period: "2025", status: "present", value: 8, normalizedValue: 0.8 },
    ];
    const threeYears: SeriesPoint[] = [
      { period: "2023", status: "present", value: 20, normalizedValue: 2 },
      { period: "2024", status: "present", value: 14, normalizedValue: 1.4 },
      { period: "2025", status: "present", value: 8, normalizedValue: 0.8 },
    ];
    expect(trendDelta(withGap, "multi")).toBe(-0.6);
    expect(trendDelta(consecutive, "multi")).toBe(-1.2);
    expect(trendDelta(threeYears, "multi")).toBe(-0.6);
    expect(trendYearCount(withGap, "multi")).toBe(2);
    expect(trendYearCount(threeYears, "multi")).toBe(3);
    expect(leaveOneOutTopN(9)).toBe(3);
    expect(leaveOneOutTopN(40)).toBe(4);
  });

  it("caps a single active dataset below 1.0", () => {
    expect(coverageFactor(1, 2)).toBe(0.5);
    expect(coverageFactor(2, 2)).toBe(1);
    expect(coverageFactor(0, 2)).toBe(0);
    const one = combineCandidateScore([{ closeness: 1, weight: 4 }], {
      ...SCORE_FORMULA_DEFAULTS,
      trendWeight: 0.6,
      niveauWeight: 0.4,
    });
    expect(one.nActive).toBe(1);
    expect(one.score).toBe(0.5);
    const two = combineCandidateScore(
      [
        { closeness: 1, weight: 4 },
        { closeness: 1, weight: 4 },
      ],
      SCORE_FORMULA_DEFAULTS,
    );
    expect(two.score).toBe(1);
  });

  it("weights finer Ebenen above coarser ones", () => {
    expect(grainWeight("address")).toBeGreaterThan(grainWeight("lor"));
    expect(grainWeight("grid100")).toBe(grainWeight("address"));
    expect(grainWeight("lor")).toBe(grainWeight("quartier"));
    expect(grainWeight("ortsteil")).toBe(grainWeight("plz"));
    expect(grainWeight("ortsteil")).toBeGreaterThan(grainWeight("bezirk"));
    expect(grainWeight("bezirk")).toBeGreaterThan(grainWeight("gemeinde"));
    expect(grainWeight("stadtteil")).toBe(grainWeight("ortsteil"));
  });

  it("scores trend before niveau and skips missing components", () => {
    const config = SCORE_FORMULA_DEFAULTS;
    const both = datasetCloseness(
      { trend: 1, niveau: 10 },
      { trend: 1, niveau: 0 },
      { trend: 1, niveau: 1 },
      config,
    );
    const trendOnly = datasetCloseness(
      { trend: 1, niveau: 10 },
      { trend: 1, niveau: 0 },
      { trend: 1, niveau: null },
      config,
    );
    expect(both).not.toBeNull();
    expect(trendOnly).toBe(1);
    expect(both!).toBeLessThan(trendOnly!);
    expect(
      datasetCloseness({ trend: null, niveau: null }, { trend: 1, niveau: 1 }, { trend: 1, niveau: 1 }, config),
    ).toBeNull();
    expect(
      datasetCloseness({ trend: 1, niveau: 1 }, { trend: null, niveau: null }, { trend: 1, niveau: 1 }, config),
    ).toBeNull();
  });

  it("reads ANALYSIS_SCORE_* env with 0.6/0.4 defaults", () => {
    expect(readScoreFormulaConfig(() => undefined)).toMatchObject({
      trendWeight: 0.6,
      niveauWeight: 0.4,
      minActiveDatasets: 2,
      minDispersionN: 3,
    });
    const custom = readScoreFormulaConfig((name) => {
      if (name === "ANALYSIS_SCORE_TREND_WEIGHT") return "0.8";
      if (name === "ANALYSIS_SCORE_NIVEAU_WEIGHT") return "0.2";
      if (name === "ANALYSIS_SCORE_MIN_ACTIVE_DATASETS") return "3";
      return undefined;
    });
    expect(custom.trendWeight).toBe(0.8);
    expect(custom.niveauWeight).toBe(0.2);
    expect(custom.minActiveDatasets).toBe(3);
    expect(normalizeWeights({ ...SCORE_FORMULA_DEFAULTS, trendWeight: 3, niveauWeight: 1 })).toMatchObject({
      trendWeight: 0.75,
      niveauWeight: 0.25,
    });
  });
});

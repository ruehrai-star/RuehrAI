import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PatternCriterion } from "../analysis/types";
import { YearlySeries } from "../analysis/yearly-series";
import { AreaCandidate } from "./area-candidates";
import { looExitCode, parseLooArgs, runScoreLoo } from "./score-loo-cli";
import { LooFixture } from "./score-loo-fixture";
import { DEFAULT_LOO_USER_ID } from "./score-loo-stage";

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

function candidate(geoKey: string, first: number, last: number): { area: AreaCandidate; series: YearlySeries[] } {
  return {
    area: {
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
      targetRegionGeoKey: "ortsteil:osm:region",
    },
    series: [
      {
        metricId: "unfallatlas",
        requestedLevel: "lor",
        requestedGeoKey: geoKey,
        sourceLevel: "lor",
        sourceGeoKey: geoKey,
        granularity: "year",
        coverage: "multi",
        points: [
          { period: "2023", status: "present", value: first },
          { period: "2024", status: "present", value: (first + last) / 2 },
          { period: "2025", status: "present", value: last },
        ],
      },
      {
        metricId: "bevoelkerung",
        requestedLevel: "lor",
        requestedGeoKey: geoKey,
        sourceLevel: "lor",
        sourceGeoKey: geoKey,
        granularity: "year",
        coverage: "multi",
        points: [
          { period: "2023", status: "present", value: 10_000 },
          { period: "2024", status: "present", value: 10_000 },
          { period: "2025", status: "present", value: 10_000 },
        ],
      },
    ],
  };
}

describe("score:loo CLI wiring", () => {
  afterEach(() => {
    process.exitCode = 0;
  });

  it("parses user-id and run-id and defaults user 2", () => {
    expect(parseLooArgs([])).toEqual({ userId: DEFAULT_LOO_USER_ID });
    expect(parseLooArgs(["--user-id", "9", "--run-id", "64", "--out", "./loo-out"])).toEqual({
      userId: "9",
      runId: "64",
      out: "./loo-out",
    });
  });

  it("prints usage instead of throwing LOO_STAGE_NOT_WIRED when env and fixture are absent", async () => {
    const chunks: string[] = [];
    const result = await runScoreLoo([], {
      env: {},
      stdout: { write: (chunk) => chunks.push(chunk) },
    });
    expect(result.passed).toBe(true);
    expect(chunks.join("")).toContain("SCORE_LOO_DATABASE_URL");
    expect(chunks.join("")).not.toContain("LOO_STAGE_NOT_WIRED");
  });

  it("loads STAGE when SCORE_LOO_DATABASE_URL is set without --fixture", async () => {
    const storeKeys = ["lor:plr:s1", "lor:plr:s2", "lor:plr:s3"];
    const far = ["lor:plr:f1", "lor:plr:f2", "lor:plr:f3", "lor:plr:f4", "lor:plr:f5", "lor:plr:f6"];
    const built = [...storeKeys.map((key, index) => candidate(key, 20 - index, 8 + index)), ...far.map((key, index) => candidate(key, 5 + index, 30 - index))];
    const fixture: LooFixture = {
      targetRegionGeoKey: "ortsteil:osm:region",
      stores: storeKeys.map((geoKey, index) => ({ geoKey, title: `Filiale ${index + 1}` })),
      pool: built.map((item) => item.area),
      yearly: built.flatMap((item) => item.series),
      criteria: [criterion],
    };
    const written: { markdown?: string; json?: string } = {};
    let stageUser: string | undefined;
    const result = await runScoreLoo(["--out", "./loo-out"], {
      env: { SCORE_LOO_DATABASE_URL: "postgres://readonly@localhost/Brain" },
      loadStage: async (options) => {
        stageUser = options.userId;
        return fixture;
      },
      writeOut: async (_dir, files) => {
        written.markdown = files.markdown;
        written.json = files.json;
      },
    });
    expect(stageUser).toBe("2");
    expect(written.markdown).toContain("Leave-one-out");
    expect(written.json).toContain("nAktiv");
    expect(JSON.parse(written.json ?? "{}").rows.every((row: { nAktiv: number }) => row.nAktiv >= 1)).toBe(true);
    expect(result.passed).toBe(true);
  });

  it("applies valueKey hygiene on --fixture so nAktiv is not falsely 0", async () => {
    const storeKeys = ["lor:plr:s1", "lor:plr:s2", "lor:plr:s3"];
    const far = ["lor:plr:f1", "lor:plr:f2", "lor:plr:f3", "lor:plr:f4", "lor:plr:f5", "lor:plr:f6"];
    const built = [...storeKeys.map((key) => candidate(key, 20, 8)), ...far.map((key) => candidate(key, 5, 30))];
    const raw: LooFixture = {
      targetRegionGeoKey: "ortsteil:osm:region",
      stores: storeKeys.map((geoKey, index) => ({ geoKey, title: `Filiale ${index + 1}` })),
      pool: built.map((item) => item.area),
      yearly: built.flatMap((item) => item.series),
      criteria: [{ ...criterion, baseline: "per_km2" }],
    };
    expect(raw.yearly.filter((entry) => entry.metricId === "unfallatlas").every((entry) => !entry.valueKey)).toBe(true);
    const result = await runScoreLoo(["--fixture", "loo-fixture.json"], {
      env: {},
      loadFixtureFile: async () => raw,
      stdout: { write: () => undefined },
    });
    expect(result.fixture.yearly.filter((entry) => entry.metricId === "unfallatlas").every((entry) => entry.valueKey === "unfaelle_je_km2")).toBe(
      true,
    );
  });

  it("maps LOO_TOO_FEW_STORES to exit 2", () => {
    expect(looExitCode({ code: "LOO_TOO_FEW_STORES" })).toBe(2);
    expect(looExitCode({ code: "LOO_STAGE_NOT_WIRED" })).toBe(1);
  });

  it("removes the PREPARE stub from the score:loo script", () => {
    const source = readFileSync(resolve(__dirname, "../../scripts/score-loo-real.ts"), "utf8");
    expect(source).not.toContain("LOO_STAGE_NOT_WIRED");
    expect(source).toContain("runScoreLoo");
  });
});

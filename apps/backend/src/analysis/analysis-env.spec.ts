import { ANALYSIS_ENV_DEFAULTS, readAnalysisRunDeadlineMs, readPgAnalysisPoolMax } from "./analysis-env";

describe("analysis env defaults", () => {
  it("uses 120s run deadline and a small analysis pool when unset", () => {
    expect(readAnalysisRunDeadlineMs(() => undefined)).toBe(120_000);
    expect(ANALYSIS_ENV_DEFAULTS.runDeadlineMs).toBe(120_000);
    expect(ANALYSIS_ENV_DEFAULTS.runDeadlineMs).toBeLessThan(150_000);
    expect(readPgAnalysisPoolMax(() => undefined)).toBe(2);
  });

  it("reads ANALYSIS_RUN_DEADLINE_MS", () => {
    expect(readAnalysisRunDeadlineMs((name) => (name === "ANALYSIS_RUN_DEADLINE_MS" ? "5000" : undefined))).toBe(
      5_000,
    );
  });
});

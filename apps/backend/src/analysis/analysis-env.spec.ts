import {
  ANALYSIS_ENV_DEFAULTS,
  readAnalysisRunDeadlineMs,
  readAnalysisSeriesCandidateCap,
  readAnalysisUseWorkerThreads,
  readPgAnalysisPoolMax,
} from "./analysis-env";

describe("analysis env defaults", () => {
  it("uses 120s run deadline and a small analysis pool when unset", () => {
    expect(readAnalysisRunDeadlineMs(() => undefined)).toBe(120_000);
    expect(ANALYSIS_ENV_DEFAULTS.scoreTrendWeight).toBe(0.6);
    expect(ANALYSIS_ENV_DEFAULTS.scoreNiveauWeight).toBe(0.4);
    expect(ANALYSIS_ENV_DEFAULTS.scoreMinActiveDatasets).toBe(2);
    expect(ANALYSIS_ENV_DEFAULTS.runDeadlineMs).toBe(120_000);
    expect(ANALYSIS_ENV_DEFAULTS.runDeadlineMs).toBeLessThan(150_000);
    expect(readPgAnalysisPoolMax(() => undefined)).toBe(2);
    expect(readAnalysisSeriesCandidateCap(() => undefined)).toBe(400);
    expect(readAnalysisUseWorkerThreads(() => undefined)).toBe(true);
  });

  it("reads ANALYSIS_SERIES_CANDIDATE_CAP and worker-thread flag", () => {
    expect(
      readAnalysisSeriesCandidateCap((name) => (name === "ANALYSIS_SERIES_CANDIDATE_CAP" ? "250" : undefined)),
    ).toBe(250);
    expect(readAnalysisUseWorkerThreads((name) => (name === "ANALYSIS_USE_WORKER_THREADS" ? "0" : undefined))).toBe(
      false,
    );
  });

  it("reads ANALYSIS_RUN_DEADLINE_MS", () => {
    expect(readAnalysisRunDeadlineMs((name) => (name === "ANALYSIS_RUN_DEADLINE_MS" ? "5000" : undefined))).toBe(
      5_000,
    );
  });
});

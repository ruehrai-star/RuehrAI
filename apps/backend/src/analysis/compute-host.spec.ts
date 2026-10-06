import { keysForResolvedPlace, SeriesFeatureRow } from "./yearly-series";
import { runComputeJob } from "./compute-host";
import { analysisDeadlineError } from "./failure-reason";

jest.setTimeout(20_000);

describe("compute host worker threads", () => {
  it("builds YearlySeries for a heavy job (worker preferred, chunked fallback)", async () => {
    const resolved = Array.from({ length: 24 }, (_, index) =>
      keysForResolvedPlace("ortsteil", `ortsteil:osm:${index}`, "05315000", "05315", "05"),
    );
    const result = await runComputeJob({
      type: "yearlySeries",
      resolved,
      docs: docs(),
      asOfIso: "2026-10-05T11:00:00.000Z",
      catalog: [],
      rows: [],
    });
    expect(result.type).toBe("yearlySeries");
    if (result.type === "yearlySeries") {
      expect(result.stats.regions).toBe(24);
      expect(result.series.length).toBeGreaterThan(0);
    }
  });

  it("terminates the worker on AbortSignal and surfaces ANALYSIS_DEADLINE", async () => {
    const resolved = Array.from({ length: 80 }, (_, index) =>
      keysForResolvedPlace("ortsteil", `ortsteil:osm:${index}`, "05315000", "05315", "05"),
    );
    const controller = new AbortController();
    const pending = runComputeJob(
      {
        type: "yearlySeries",
        resolved,
        docs: docs(),
        asOfIso: "2026-10-05T11:00:00.000Z",
        catalog: [],
        rows: [],
      },
      controller.signal,
    );
    controller.abort(analysisDeadlineError());
    await expect(pending).rejects.toMatchObject({ code: "ANALYSIS_DEADLINE" });
  });
});

function docs(): SeriesFeatureRow[] {
  return ["2023", "2024", "2025"].map((period) => ({
    source_theme: "regionalstatistik_bevoelkerung",
    grain: "ags",
    geo_key: "05315000",
    metadata: { geo_ags: "05315000", personen: 1_000_000 },
    ref_period: period,
  }));
}

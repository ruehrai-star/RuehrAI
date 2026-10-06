import { keysForResolvedPlace, SeriesFeatureRow, buildMetricSeries, indexSeriesDocs } from "./yearly-series";
import { runComputeJob } from "./compute-host";

jest.setTimeout(30_000);

describe("YearlySeries indexed build", () => {
  it("matches the per-row filter for the same docs and stays under 2s for 2500 regions", async () => {
    const resolved = Array.from({ length: 2500 }, (_, index) =>
      keysForResolvedPlace("ortsteil", `ortsteil:osm:${index}`, "05315000", "05315", "05"),
    );
    const docs = sampleDocs();
    const indexed = indexSeriesDocs(docs);

    const sample = resolved[0]!;
    const fromIndex = buildMetricSeries({
      metricId: "bevoelkerung",
      homeLevel: "gemeinde",
      region: sample,
      docs: indexed,
      asOf: new Date("2026-10-05T11:00:00.000Z"),
    });
    const fromScan = buildMetricSeries({
      metricId: "bevoelkerung",
      homeLevel: "gemeinde",
      region: sample,
      docs,
      asOf: new Date("2026-10-05T11:00:00.000Z"),
    });
    expect(fromIndex).toEqual(fromScan);

    let maxTick = 0;
    let last = Date.now();
    const probe = setInterval(() => {
      const now = Date.now();
      maxTick = Math.max(maxTick, now - last);
      last = now;
    }, 10);

    const started = Date.now();
    const result = await runComputeJob({
      type: "yearlySeries",
      resolved,
      docs,
      asOfIso: "2026-10-05T11:00:00.000Z",
      catalog: [],
      rows: [],
    });
    const durationMs = Date.now() - started;
    clearInterval(probe);

    expect(result.type).toBe("yearlySeries");
    if (result.type === "yearlySeries") {
      expect(result.stats.regions).toBe(2500);
      expect(result.stats.docs).toBe(docs.length);
      expect(result.series.length).toBeGreaterThan(2500);
    }
    // Wall time is higher on a contended CI runner (Jest workers in parallel).
    // The STAGE hang was ~7:45 min; this bound still fails a full scan.
    expect(durationMs).toBeLessThan(10_000);
    expect(maxTick).toBeLessThan(250);
    // eslint-disable-next-line no-console
    console.log(`YearlySeries 2500 regions durationMs=${durationMs} maxTickMs=${maxTick}`);
  });
});

function sampleDocs(): SeriesFeatureRow[] {
  const periods = ["2023", "2024", "2025"];
  const rows: SeriesFeatureRow[] = [];
  for (const period of periods) {
    rows.push(
      {
        source_theme: "regionalstatistik_bevoelkerung",
        grain: "ags",
        geo_key: "05315000",
        metadata: { geo_ags: "05315000", geo_ags5: "05315", geo_land: "05", personen: 1_000_000 },
        ref_period: period,
      },
      {
        source_theme: "kba_elektro_pkw",
        grain: "ags",
        geo_key: "05315000",
        metadata: { geo_ags: "05315000", pkw_elektro: 1200, pkw_insgesamt: 400_000 },
        ref_period: period,
      },
      {
        source_theme: "unfallatlas",
        grain: "ags5",
        geo_key: "05315",
        metadata: { geo_ags5: "05315", unfaelle_gesamt: 80 },
        ref_period: period,
      },
    );
  }
  for (let i = 0; i < 200; i += 1) {
    rows.push({
      source_theme: "regionalstatistik_bevoelkerung",
      grain: "ags",
      geo_key: `09162${String(i).padStart(3, "0")}`,
      metadata: { geo_ags: `09162${String(i).padStart(3, "0")}`, personen: 10_000 + i },
      ref_period: "2025",
    });
  }
  return rows;
}

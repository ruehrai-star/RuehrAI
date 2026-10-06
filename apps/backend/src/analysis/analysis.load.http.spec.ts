import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { HealthModule } from "../health/health.module";
import { AnalysisRegion } from "./types";
import { keysForResolvedPlace, SeriesFeatureRow } from "./yearly-series";
import { runComputeJob } from "./compute-host";
import { analysisDeadlineError } from "./failure-reason";
import { AreaCandidate, AreaKind } from "../recommendations/area-candidates";
import { capCandidatesForSeries, DEFAULT_SERIES_CANDIDATE_CAP } from "../recommendations/candidate-cap";

jest.setTimeout(60_000);

const STORE_COUNT = 3;
const CANDIDATE_COUNT = 2000;
const KINDS: AreaKind[] = ["lor", "quartier", "ortsteil", "plz", "bezirk", "gemeinde"];

describe("analysis load: health stays up during 3 stores × ~2000 candidates", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("answers GET /health under 1s in every sample while cap + YearlySeries + rank run", async () => {
    const fixture = loadFixture();
    const controller = new AbortController();
    const deadlineMs = 15_000;
    const deadline = setTimeout(() => controller.abort(analysisDeadlineError()), deadlineMs);

    const latencies: number[] = [];
    let polling = true;
    const poll = (async () => {
      while (polling) {
        const started = Date.now();
        const response = await request(app.getHttpServer()).get("/health").expect(200);
        latencies.push(Date.now() - started);
        expect(response.body).toEqual({ status: "ok" });
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    })();

    const started = Date.now();
    let outcome: "completed" | "timeout" | "failed" = "completed";
    let wroteSet = false;
    try {
      await runTwoStageCompute(fixture, controller.signal);
    } catch (error) {
      outcome = (error as { code?: string }).code === "ANALYSIS_DEADLINE" ? "timeout" : "failed";
      if (outcome === "timeout") {
        expect((error as { code?: string }).code).toBe("ANALYSIS_DEADLINE");
      } else {
        throw error;
      }
    } finally {
      clearTimeout(deadline);
      polling = false;
      await poll;
    }
    const durationMs = Date.now() - started;
    const maxHealthMs = Math.max(...latencies, 0);
    expect(latencies.length).toBeGreaterThan(3);
    expect(maxHealthMs).toBeLessThan(1000);
    expect(durationMs).toBeLessThan(deadlineMs);
    expect(["completed", "timeout", "failed"]).toContain(outcome);
    expect(wroteSet).toBe(false);
    // eslint-disable-next-line no-console
    console.log(
      `Load test 3 stores × ${CANDIDATE_COUNT} candidates durationMs=${durationMs} maxHealthMs=${maxHealthMs} samples=${latencies.length} outcome=${outcome} setWritten=${wroteSet}`,
    );
  });

  it("aborts a heavy YearlySeries job via AbortSignal without hanging the event loop", async () => {
    const resolved = Array.from({ length: CANDIDATE_COUNT }, (_, index) =>
      keysForResolvedPlace("ortsteil", `ortsteil:osm:${index}`, "05315000", "05315", "05"),
    );
    const docs = loadDocs();
    const controller = new AbortController();
    const latencies: number[] = [];
    let polling = true;
    const poll = (async () => {
      while (polling) {
        const started = Date.now();
        await request(app.getHttpServer()).get("/health").expect(200);
        latencies.push(Date.now() - started);
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    })();

    const started = Date.now();
    setTimeout(() => controller.abort(analysisDeadlineError()), 20);
    await expect(
      runComputeJob(
        {
          type: "yearlySeries",
          resolved,
          docs,
          asOfIso: "2026-10-05T11:00:00.000Z",
          catalog: [],
          rows: [],
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: "ANALYSIS_DEADLINE" });
    polling = false;
    await poll;
    const durationMs = Date.now() - started;
    const maxHealthMs = Math.max(...latencies, 0);
    expect(maxHealthMs).toBeLessThan(1000);
    expect(durationMs).toBeLessThan(5_000);
    // eslint-disable-next-line no-console
    console.log(
      `Load abort 3×${CANDIDATE_COUNT} durationMs=${durationMs} maxHealthMs=${maxHealthMs} samples=${latencies.length} outcome=timeout setWritten=false`,
    );
  });
});

async function runTwoStageCompute(
  fixture: ReturnType<typeof loadFixture>,
  signal: AbortSignal,
): Promise<void> {
  const capped = capCandidatesForSeries(fixture.candidates, fixture.regions, DEFAULT_SERIES_CANDIDATE_CAP);
  expect(capped.candidateCount).toBe(CANDIDATE_COUNT);
  expect(capped.selected.length).toBeLessThanOrEqual(DEFAULT_SERIES_CANDIDATE_CAP);
  expect(capped.truncated).toBe(true);
  for (const region of fixture.regions) {
    const hits = capped.selected.filter(
      (item) => item.ags === region.ags || item.geoKey.startsWith(`${region.geoKey}:`),
    );
    expect(hits.length).toBeGreaterThan(0);
  }

  const resolved = capped.selected.map((item, index) =>
    keysForResolvedPlace(
      "ortsteil",
      item.geoKey,
      item.ags ?? fixture.regions[index % fixture.regions.length]!.ags ?? "05315000",
      (item.ags ?? "05315").slice(0, 5),
      (item.ags ?? "05").slice(0, 2),
    ),
  );
  const seriesJob = await runComputeJob(
    {
      type: "yearlySeries",
      resolved,
      docs: fixture.docs,
      asOfIso: "2026-10-05T11:00:00.000Z",
      catalog: [],
      rows: [],
    },
    signal,
  );
  if (seriesJob.type !== "yearlySeries") throw new Error(`expected yearlySeries, got ${seriesJob.type}`);

  const rankJob = await runComputeJob(
    {
      type: "rank",
      candidates: capped.selected.map((item) => ({ ...item, geometry: null })),
      series: seriesJob.series,
      criteria: [{ key: "unfallatlas", label: "Unfälle", direction: "down", evidence: "fällt", kind: "trend" }],
      regions: fixture.regions,
    },
    signal,
  );
  if (rankJob.type !== "rank") throw new Error(`expected rank, got ${rankJob.type}`);
  expect(rankJob.ranked.length).toBeGreaterThan(0);
}

function loadFixture(): {
  regions: AnalysisRegion[];
  candidates: AreaCandidate[];
  docs: SeriesFeatureRow[];
} {
  const regions = storeRegions();
  const candidates: AreaCandidate[] = [];
  let index = 0;
  while (candidates.length < CANDIDATE_COUNT) {
    const region = regions[index % STORE_COUNT]!;
    const kind = KINDS[index % KINDS.length]!;
    const geoKey = `${kind}:${region.geoKey}:${index}`;
    candidates.push({
      id: `other:${geoKey}`,
      geoKey,
      grain: "other",
      kind,
      title: `${region.label} ${kind} ${index}`,
      name: `${region.label} ${kind} ${index}`,
      ags: region.ags,
      plz: null,
      lon: region.lon,
      lat: region.lat,
    });
    index += 1;
  }
  return { regions, candidates, docs: loadDocs() };
}

function storeRegions(): AnalysisRegion[] {
  return [
    region("Köln", "05315000", 6.96, 50.94),
    region("Berlin", "11000000", 13.4, 52.52),
    region("München", "09162000", 11.58, 48.14),
  ];
}

function region(label: string, ags: string, lon: number, lat: number): AnalysisRegion {
  return {
    label,
    grain: "ags",
    geoKey: ags,
    level: "gemeinde",
    parentLabel: null,
    ags,
    plz: null,
    lon,
    lat,
    bounds: null,
    geometry: null,
    updatedAt: "2026-10-06T00:00:00.000Z",
  };
}

function loadDocs(): SeriesFeatureRow[] {
  const rows: SeriesFeatureRow[] = [];
  const municipalities = ["05315000", "11000000", "09162000"];
  for (const period of ["2023", "2024", "2025"]) {
    for (const ags of municipalities) {
      rows.push({
        source_theme: "regionalstatistik_bevoelkerung",
        grain: "ags",
        geo_key: ags,
        metadata: { geo_ags: ags, geo_ags5: ags.slice(0, 5), geo_land: ags.slice(0, 2), personen: 1_000_000 },
        ref_period: period,
      });
      rows.push({
        source_theme: "unfallatlas",
        grain: "ags5",
        geo_key: ags.slice(0, 5),
        metadata: { geo_ags5: ags.slice(0, 5), unfaelle_gesamt: 90 },
        ref_period: period,
      });
    }
  }
  for (let i = 0; i < 400; i += 1) {
    rows.push({
      source_theme: "regionalstatistik_bevoelkerung",
      grain: "ags",
      geo_key: `11000${String(i).padStart(3, "0")}`,
      metadata: { geo_ags: `11000${String(i).padStart(3, "0")}`, personen: 8000 + i },
      ref_period: "2025",
    });
  }
  return rows;
}

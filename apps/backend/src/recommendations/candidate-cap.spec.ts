import { AnalysisRegion } from "../analysis/types";
import { AreaCandidate, AreaKind, stampCandidateTargetRegion } from "./area-candidates";
import { assignTargetRegion, capCandidatesForSeries, cheapBaselineScore } from "./candidate-cap";

const KINDS: AreaKind[] = ["lor", "quartier", "ortsteil", "plz", "bezirk", "gemeinde"];

describe("capCandidatesForSeries", () => {
  it("keeps a fair share per Zielregion and every Ebene when capping 2162 candidates", () => {
    const regions = targetRegions();
    const candidates = buildCandidates(regions, 2162);
    const kindsPresent = new Set(candidates.map((item) => item.kind));
    const capped = capCandidatesForSeries(candidates, regions, 400);

    expect(candidates.length).toBe(2162);
    expect(capped.candidateCount).toBe(2162);
    expect(capped.cappedCount).toBeLessThanOrEqual(400);
    expect(capped.selected.length).toBeLessThanOrEqual(400);
    expect(capped.truncated).toBe(true);

    for (const region of regions) {
      const hits = capped.selected.filter((item) => item.targetRegionGeoKey === region.geoKey);
      expect(hits.length).toBeGreaterThan(0);
    }

    const selectedKinds = new Set(capped.selected.map((item) => item.kind));
    for (const kind of kindsPresent) {
      expect(selectedKinds.has(kind)).toBe(true);
    }
  });

  it("shares the cap by targetRegionGeoKey when every region has ags=null and plz=null", () => {
    const regions = targetRegions().map((region) => ({ ...region, ags: null, plz: null }));
    const candidates = buildCandidates(regions, 2162).map((item) => ({ ...item, ags: null, plz: null }));
    expect(candidates.every((item) => item.ags == null && item.plz == null)).toBe(true);
    expect(new Set(candidates.map((item) => assignTargetRegion(item, regions)))).toEqual(
      new Set(regions.map((region) => region.geoKey)),
    );

    const capped = capCandidatesForSeries(candidates, regions, 400);
    expect(capped.selected.length).toBe(400);
    for (const region of regions) {
      const hits = capped.selected.filter((item) => item.targetRegionGeoKey === region.geoKey);
      expect(hits.length).toBeGreaterThanOrEqual(Math.floor(400 / regions.length));
    }
    expect(capped.selected.some((item) => assignTargetRegion(item) === "_unassigned")).toBe(false);
  });

  it("ranks finer grain above coarser grain in the cheap baseline score", () => {
    const lor = candidate("lor:plr:1", "lor", "11000007");
    const bezirk = candidate("11000007", "bezirk", "11000007");
    expect(cheapBaselineScore(lor)).toBeGreaterThan(cheapBaselineScore(bezirk));
  });
});

function targetRegions(): AnalysisRegion[] {
  return [
    region("Innenstadt", "bezirk:osm:2613798", "05315000"),
    region("Lichterfelde", "ortsteil:osm:licht", "11000006"),
    region("Tempelhof", "ortsteil:osm:tempel", "11000007"),
    region("Mariendorf", "ortsteil:osm:marien", "11000007b"),
    region("Lankwitz", "ortsteil:osm:lank", "11000006b"),
    region("Steglitz", "ortsteil:osm:steg", "11000006c"),
  ];
}

function region(label: string, geoKey: string, ags: string | null): AnalysisRegion {
  return {
    label,
    grain: "other",
    geoKey,
    level: "bezirk",
    parentLabel: null,
    ags,
    plz: null,
    lon: null,
    lat: null,
    bounds: null,
    geometry: null,
    updatedAt: "2026-10-06T00:00:00.000Z",
  };
}

function buildCandidates(regions: AnalysisRegion[], total: number): AreaCandidate[] {
  const out: AreaCandidate[] = [];
  let index = 0;
  while (out.length < total) {
    const region = regions[index % regions.length]!;
    const kind = KINDS[index % KINDS.length]!;
    out.push(
      stampCandidateTargetRegion(
        candidate(`${kind}:${region.geoKey}:${index}`, kind, region.ags ?? "00000000", region.geoKey ?? kind),
        region.geoKey ?? kind,
      ),
    );
    index += 1;
  }
  return out;
}

function candidate(geoKey: string, kind: AreaKind, ags: string, title = geoKey): AreaCandidate {
  return {
    id: `other:${geoKey}`,
    geoKey,
    grain: "other",
    kind,
    title,
    name: title,
    ags,
    plz: null,
    lon: 13.4,
    lat: 52.5,
  };
}

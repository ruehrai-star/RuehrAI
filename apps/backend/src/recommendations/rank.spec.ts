import { PatternCriterion } from "../analysis/types";
import { recommendationReason } from "./messages";
import { rankCandidates, withoutRegionAnchor } from "./rank";
import { CandidateRow } from "./types";

const months = new Set(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);

const criteria: PatternCriterion[] = [
  { key: "einwohner", label: "einwohner", direction: "up", evidence: "steigt" },
  { key: "haushalte", label: "haushalte", direction: "up", evidence: "steigt" },
];

function row(overrides: Partial<CandidateRow> & Pick<CandidateRow, "geoKey" | "refPeriod">): CandidateRow {
  return {
    id: overrides.id ?? "1",
    geoKey: overrides.geoKey,
    grain: overrides.grain ?? "plz5",
    name: overrides.name ?? null,
    title: overrides.title ?? overrides.geoKey,
    refPeriod: overrides.refPeriod,
    metadata: overrides.metadata ?? {},
    lon: overrides.lon ?? null,
    lat: overrides.lat ?? null,
  };
}

describe("rankCandidates", () => {
  it("ranks positive pattern fits and drops the opposite direction", () => {
    const ranked = rankCandidates(
      [
        row({
          geoKey: "80801",
          title: "Schwabing",
          refPeriod: "2026-04",
          lon: 11.58,
          lat: 48.16,
          metadata: { einwohner: 10, haushalte: 5 },
        }),
        row({
          geoKey: "80801",
          title: "Schwabing",
          refPeriod: "2026-09",
          lon: 11.58,
          lat: 48.16,
          metadata: { einwohner: 20, haushalte: 9 },
        }),
        row({
          geoKey: "81369",
          title: "Sendling",
          refPeriod: "2026-04",
          metadata: { einwohner: 10, haushalte: 4 },
        }),
        row({
          geoKey: "81369",
          title: "Sendling",
          refPeriod: "2026-09",
          metadata: { einwohner: 30, haushalte: 8 },
        }),
        row({
          geoKey: "81541",
          title: "Giesing",
          refPeriod: "2026-04",
          metadata: { einwohner: 10, haushalte: 9 },
        }),
        row({
          geoKey: "81541",
          title: "Giesing",
          refPeriod: "2026-09",
          metadata: { einwohner: 20, haushalte: 5 },
        }),
        row({
          geoKey: "80686",
          title: "Laim",
          refPeriod: "2026-04",
          metadata: { einwohner: 20, haushalte: 8 },
        }),
        row({
          geoKey: "80686",
          title: "Laim",
          refPeriod: "2026-09",
          metadata: { einwohner: 10, haushalte: 4 },
        }),
        row({
          geoKey: "81541",
          title: "Giesing",
          refPeriod: "2020-01",
          metadata: { einwohner: 1, haushalte: 1 },
        }),
      ],
      criteria,
      months,
    );

    expect(ranked.map((item) => item.title)).toEqual(["Schwabing", "Sendling", "Giesing"]);
    expect(ranked.map((item) => item.score)).toEqual([1, 1, 0.5]);
    expect(ranked[0]).toMatchObject({
      id: "plz5:80801",
      location: { geoKey: "80801", grain: "plz5", lon: 11.58, lat: 48.16 },
    });
    expect(ranked[0]?.criteriaEvidence.map((entry) => entry.key)).toEqual(["einwohner", "haushalte"]);
    expect(ranked[2]?.criteriaEvidence.map((entry) => entry.key)).toEqual(["einwohner"]);
    expect(ranked[0]?.criteriaEvidence[0]?.evidence).toContain("2026-04");
    expect(ranked[0]?.criteriaEvidence[0]?.evidence).toContain("2026-09");
  });

  it("formats count-like evidence as whole numbers", () => {
    const ranked = rankCandidates(
      [
        row({
          geoKey: "80801",
          title: "Schwabing",
          refPeriod: "2026-04",
          metadata: { wohnungen: 400000.33 },
        }),
        row({
          geoKey: "80801",
          title: "Schwabing",
          refPeriod: "2026-09",
          metadata: { wohnungen: 500000.6 },
        }),
      ],
      [{ key: "wohnungen", label: "wohnungen", direction: "up", evidence: "steigt" }],
      months,
    );
    expect(ranked[0]?.criteriaEvidence[0]?.evidence).toContain("400.000");
    expect(ranked[0]?.criteriaEvidence[0]?.evidence).toContain("500.001");
    expect(ranked[0]?.criteriaEvidence[0]?.evidence).not.toContain(",33");
  });

  it("returns nothing when the pattern has no direction", () => {
    const ranked = rankCandidates(
      [
        row({ geoKey: "80801", refPeriod: "2026-04", metadata: { einwohner: 1 } }),
        row({ geoKey: "80801", refPeriod: "2026-09", metadata: { einwohner: 2 } }),
      ],
      [{ key: "einwohner", label: "einwohner", direction: "unknown", evidence: "ein Stichtag" }],
      months,
    );
    expect(ranked).toEqual([]);
  });

  it("keeps the region anchor only when nothing finer fits", () => {
    const city = rankCandidates(
      [
        row({
          geoKey: "09162000",
          grain: "ags",
          title: "München",
          refPeriod: "2026-04",
          metadata: { einwohner: 10 },
        }),
        row({
          geoKey: "09162000",
          grain: "ags",
          title: "München",
          refPeriod: "2026-09",
          metadata: { einwohner: 12 },
        }),
      ],
      [criteria[0]!],
      months,
    );
    const alone = withoutRegionAnchor(city, {
      geoKey: "09162000",
      grain: "ags",
      ags: "09162000",
      plz: null,
    });
    expect(alone.map((item) => item.title)).toEqual(["München"]);

    const withChild = withoutRegionAnchor(
      [
        ...city,
        ...rankCandidates(
          [
            row({ geoKey: "80801", title: "Schwabing", refPeriod: "2026-04", metadata: { einwohner: 1 } }),
            row({ geoKey: "80801", title: "Schwabing", refPeriod: "2026-09", metadata: { einwohner: 3 } }),
          ],
          [criteria[0]!],
          months,
        ),
      ],
      { geoKey: "09162000", grain: "ags", ags: "09162000", plz: null },
    );
    expect(withChild.map((item) => item.id)).toEqual(["plz5:80801"]);
  });
});

describe("recommendationReason", () => {
  it("explains a thin region without turning one or two hits into an error", () => {
    expect(
      recommendationReason({
        hasDirection: true,
        factCount: 4,
        positiveCount: 1,
        truncated: false,
      }),
    ).toContain("nur 1 Standort");
    expect(
      recommendationReason({
        hasDirection: true,
        factCount: 4,
        positiveCount: 2,
        truncated: false,
      }),
    ).toContain("nur 2 Standorte");
    expect(
      recommendationReason({
        hasDirection: true,
        factCount: 4,
        positiveCount: 3,
        truncated: false,
      }),
    ).toBeNull();
  });

  it("names an empty window and a pattern without direction", () => {
    expect(
      recommendationReason({
        hasDirection: false,
        factCount: 0,
        positiveCount: 0,
        truncated: false,
      }),
    ).toContain("keine zeitliche Richtung");
    expect(
      recommendationReason({
        hasDirection: true,
        factCount: 0,
        positiveCount: 0,
        truncated: false,
      }),
    ).toContain("keine Brain-Fakten");
    expect(
      recommendationReason({
        hasDirection: true,
        factCount: 2,
        positiveCount: 0,
        truncated: false,
      }),
    ).toContain("Keine passenden Standorte");
  });
});

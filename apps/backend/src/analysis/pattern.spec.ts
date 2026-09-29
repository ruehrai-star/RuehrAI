import { buildHeuristicPattern, isGroundedKey, parseLlmPattern } from "./pattern";
import { AnalysisInput, BrainFact } from "./types";

function fact(overrides: Partial<BrainFact> = {}): BrainFact {
  return {
    id: "1",
    geoKey: "09162000",
    grain: "ags",
    title: "Gemeinde München (09162000) — Zensus 2022",
    name: "München",
    refPeriod: "2022-05",
    excerpt: "Bevölkerung und Haushalte der Gemeinde München.",
    distance: null,
    matchedBy: "region",
    signals: [{ key: "einwohner", value: "1500000" }],
    ...overrides,
  };
}

function input(): AnalysisInput {
  return {
    region: {
      label: "München",
      grain: "ags",
      geoKey: "09162000",
      ags: "09162000",
      plz: null,
      lon: null,
      lat: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    stores: [
      {
        id: "7",
        label: null,
        street: "Marienplatz 1",
        postalCode: "80331",
        city: "München",
        lon: null,
        lat: null,
        points: [
          { year: 2025, month: 1, revenueEur: 100 },
          { year: 2025, month: 2, revenueEur: 150 },
        ],
        changes: [
          {
            fromYear: 2025,
            fromMonth: 1,
            toYear: 2025,
            toMonth: 2,
            fromRevenueEur: 100,
            toRevenueEur: 150,
            changeEur: 50,
          },
        ],
      },
    ],
    revenueDirection: "up",
    capturedAt: "2026-04-01T00:00:00.000Z",
  };
}

describe("pattern", () => {
  it("marks a single Brain period as unknown and keeps the revenue direction", () => {
    const pattern = buildHeuristicPattern(input(), [fact()]);
    expect(pattern.source).toBe("heuristic");
    expect(pattern.revenueDirection).toBe("up");
    expect(pattern.criteria).toEqual([
      expect.objectContaining({
        key: "einwohner",
        direction: "unknown",
      }),
    ]);
    expect(pattern.summary).toContain("Heuristik");
    expect(pattern.summary).toContain("steigend");
  });

  it("reads a direction when the same criterion has two reference periods", () => {
    const pattern = buildHeuristicPattern(input(), [
      fact({ id: "1", refPeriod: "2022-05", signals: [{ key: "einwohner", value: "100" }] }),
      fact({ id: "2", refPeriod: "2023-05", signals: [{ key: "einwohner", value: "140" }] }),
    ]);
    expect(pattern.criteria[0]).toMatchObject({ key: "einwohner", direction: "up" });
    expect(pattern.criteria[0]?.evidence).toContain("2022-05");
    expect(pattern.criteria[0]?.evidence).toContain("2023-05");
  });

  it("accepts an LLM pattern only when every criterion is grounded", () => {
    const facts = [fact()];
    const raw = JSON.stringify({
      summary: "Der Umsatz steigt; die Bevölkerungszahl liegt nur zum Zensus vor.",
      criteria: [
        {
          key: "einwohner",
          label: "Einwohner",
          direction: "unknown",
          evidence: "Brain-Fakt 2022-05 nennt einwohner 1500000, ohne zweite Periode.",
        },
        {
          key: "kaufkraft",
          label: "Kaufkraft",
          direction: "up",
          evidence: "Kaufkraft steigt stark.",
        },
      ],
    });
    const parsed = parseLlmPattern(raw, facts, "up");
    expect(parsed?.source).toBe("llm");
    expect(parsed?.criteria.map((criterion) => criterion.key)).toEqual(["einwohner"]);
    expect(parsed?.revenueDirection).toBe("up");
    expect(isGroundedKey("kaufkraft", facts)).toBe(false);
  });

  it("drops a grounded key when the evidence does not touch the facts", () => {
    const raw = JSON.stringify({
      summary: "Umsatz und Einwohner werden nur aus den Fakten beschrieben.",
      criteria: [
        {
          key: "einwohner",
          label: "Einwohner",
          direction: "unknown",
          evidence: "Die Lage ist einfach besser geworden.",
        },
      ],
    });
    expect(parseLlmPattern(raw, [fact()], "up")).toBeNull();
  });

  it("rejects an LLM answer that invents every criterion", () => {
    const raw = JSON.stringify({
      summary: "Alles steigt wegen der Kaufkraft.",
      criteria: [
        {
          key: "kaufkraft",
          label: "Kaufkraft",
          direction: "up",
          evidence: "Die Kaufkraft ist gestiegen.",
        },
      ],
    });
    expect(parseLlmPattern(raw, [fact()], "down")).toBeNull();
  });

  it("grounds a key that appears in the title even without a signal", () => {
    expect(isGroundedKey("Zensus", [fact()])).toBe(true);
  });
});

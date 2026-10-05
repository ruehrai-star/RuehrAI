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
      bounds: null,
      geometry: null,
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

  it("formats count-like heuristic values as whole German numbers", () => {
    const pattern = buildHeuristicPattern(input(), [
      fact({
        id: "1",
        refPeriod: "2024|wohnungen",
        signals: [
          { key: "wohnungen", value: "413771.33" },
          { key: "ewz", value: "1017355.33" },
        ],
      }),
    ]);
    const wohnungen = pattern.criteria.find((criterion) => criterion.key === "wohnungen");
    const ewz = pattern.criteria.find((criterion) => criterion.key === "ewz");
    expect(wohnungen?.evidence).toContain("413.771");
    expect(wohnungen?.evidence).not.toContain("413.771,33");
    expect(ewz?.evidence).toContain("1.017.355");
    expect(ewz?.evidence).not.toContain("1.017.355,33");
  });

  it("rounds age-band person counts and labels nested raeume as Räume", () => {
    const pattern = buildHeuristicPattern(input(), [
      fact({
        id: "1",
        refPeriod: "2022-05",
        signals: [
          { key: "alter.40.59", value: "206273.67" },
          { key: "wohnungen.raeume", value: "4.4" },
        ],
      }),
    ]);
    const age = pattern.criteria.find((criterion) => criterion.key === "alter.40.59");
    const rooms = pattern.criteria.find((criterion) => criterion.key === "wohnungen.raeume");
    expect(age?.label).toBe("alter 40 59");
    expect(age?.evidence).toContain("206.274");
    expect(age?.evidence).not.toContain("206.273,67");
    expect(rooms?.label).toBe("Räume");
    expect(rooms?.evidence).toContain("Räume");
    expect(rooms?.evidence).not.toContain("wohnungen");
  });

  it("uses the nested leaf in heuristic evidence brackets, not the parent Brain suffix", () => {
    const pattern = buildHeuristicPattern(input(), [
      fact({
        id: "1",
        refPeriod: "2020|wohnungen",
        signals: [{ key: "wohnungen.raeume", value: "4.4" }],
      }),
      fact({
        id: "2",
        refPeriod: "2021|wohnungen",
        signals: [{ key: "wohnungen.raeume", value: "3.2" }],
      }),
    ]);
    const rooms = pattern.criteria.find((criterion) => criterion.key === "wohnungen.raeume");
    expect(rooms?.label).toBe("Räume");
    expect(rooms?.direction).toBe("down");
    expect(rooms?.evidence).toContain("2020|Räume");
    expect(rooms?.evidence).toContain("2021|Räume");
    expect(rooms?.evidence).not.toContain("2020|wohnungen");
    expect(rooms?.evidence).not.toContain("2021|wohnungen");

    const nested = buildHeuristicPattern(input(), [
      fact({
        refPeriod: "2024|indicators",
        signals: [{ key: "indicators.wohnungen", value: "12" }],
      }),
    ]);
    expect(nested.criteria[0]?.evidence).toContain("2024|wohnungen");
    expect(nested.criteria[0]?.evidence).not.toContain("2024|indicators");

    const theme = buildHeuristicPattern(input(), [
      fact({
        refPeriod: "2025-12|bka",
        signals: [{ key: "einwohner", value: "100" }],
      }),
    ]);
    expect(theme.criteria[0]?.evidence).toContain("2025-12|bka");

    const flatRooms = buildHeuristicPattern(input(), [
      fact({
        id: "1",
        refPeriod: "2020|wohnungen",
        signals: [{ key: "raeume", value: "4.4" }],
      }),
      fact({
        id: "2",
        refPeriod: "2021|wohnungen",
        signals: [{ key: "raeume", value: "3.2" }],
      }),
    ]);
    const flat = flatRooms.criteria.find((criterion) => criterion.key === "raeume");
    expect(flat?.label).toBe("Räume");
    expect(flat?.evidence).toContain("2020|Räume");
    expect(flat?.evidence).not.toContain("2020|wohnungen");
  });

  it("keeps rate-like heuristic values fractional", () => {
    const pattern = buildHeuristicPattern(input(), [
      fact({
        signals: [{ key: "pkw_elektro_anteil", value: "4.1" }],
      }),
    ]);
    expect(pattern.criteria[0]?.evidence).toContain("4,1");
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

  it("uses only the Zielregion Einwohner, never the Köln/Dortmund/Düsseldorf mean 742286.33", () => {
    const pattern = buildHeuristicPattern(koelnInput(), [
      cityFact("koeln-zensus", "05315000", "ags", [
        { key: "source_theme", value: "zensus2022" },
        { key: "ewz", value: "1017355" },
      ]),
      cityFact("dortmund", "05913000", "ags", [
        { key: "source_theme", value: "zensus2022" },
        { key: "ewz", value: "598246" },
      ]),
      cityFact("duesseldorf", "05111000", "ags", [
        { key: "source_theme", value: "zensus2022" },
        { key: "ewz", value: "611258" },
      ]),
    ]);
    const blob = criterionBlob(pattern);
    expect(blob).not.toContain("742.286");
    expect(blob).not.toContain("742286");
    expect(blob).not.toContain("598.246");
    expect(blob).not.toContain("611.258");
    const ewz = pattern.criteria.find((criterion) => criterion.key === "ewz");
    expect(ewz?.evidence).toContain("1.017.355");
  });

  it("prefers Destatis bev_insgesamt at ags5 05315 over Zensus ewz for Köln", () => {
    const pattern = buildHeuristicPattern(koelnInput(), [
      cityFact(
        "koeln-destatis",
        "05315",
        "ags5",
        [
          { key: "source_theme", value: "destatis" },
          { key: "bev_insgesamt", value: "1025523" },
        ],
        "2025-12",
      ),
      cityFact("koeln-zensus", "05315000", "ags", [
        { key: "source_theme", value: "zensus2022" },
        { key: "ewz", value: "1017355" },
      ]),
      cityFact("dortmund", "05913000", "ags", [
        { key: "source_theme", value: "zensus2022" },
        { key: "ewz", value: "598246" },
      ]),
      cityFact("duesseldorf", "05111000", "ags", [
        { key: "source_theme", value: "zensus2022" },
        { key: "ewz", value: "611258" },
      ]),
    ]);
    const blob = criterionBlob(pattern);
    expect(blob).not.toContain("742.286");
    expect(blob).not.toContain("742286");
    expect(pattern.criteria.find((criterion) => criterion.key === "ewz")).toBeUndefined();
    const bev = pattern.criteria.find((criterion) => criterion.key === "bev_insgesamt");
    expect(bev?.evidence).toContain("1.025.523");
    expect(bev?.label).not.toContain("Kreis");
  });

  it("does not average rate metrics across foreign geoKeys either", () => {
    const pattern = buildHeuristicPattern(koelnInput(), [
      cityFact("koeln-kba", "05315", "ags5", [{ key: "pkw_elektro_anteil", value: "4.1" }]),
      cityFact("dortmund-kba", "05913", "ags5", [{ key: "pkw_elektro_anteil", value: "9.9" }]),
    ]);
    expect(pattern.criteria[0]?.evidence).toContain("4,1");
    expect(pattern.criteria[0]?.evidence).not.toContain("9,9");
    expect(pattern.criteria[0]?.evidence).not.toContain("7,0");
  });

  it("labels a Kreis Einwohner value when the Zielregion is an Ortsteil", () => {
    const pattern = buildHeuristicPattern(
      {
        ...koelnInput(),
        region: {
          ...koelnInput().region,
          label: "Deutz",
          grain: "other",
          geoKey: "ortsteil:osm:deutz",
          level: "ortsteil",
          ags: "05315000",
        },
      },
      [
        cityFact(
          "kreis-destatis",
          "05315",
          "ags5",
          [
            { key: "source_theme", value: "destatis" },
            { key: "bev_insgesamt", value: "1025523" },
          ],
          "2025-12",
        ),
      ],
    );
    const bev = pattern.criteria.find((criterion) => criterion.key === "bev_insgesamt");
    expect(bev?.label).toBe("bev insgesamt (Kreis)");
    expect(bev?.evidence).toContain("Kreis");
    expect(bev?.evidence).toContain("1.025.523");
  });

  it("omits a metric that only exists on foreign geoKeys instead of inventing a mean", () => {
    const pattern = buildHeuristicPattern(koelnInput(), [
      cityFact("dortmund", "05913000", "ags", [{ key: "ewz", value: "598246" }]),
      cityFact("duesseldorf", "05111000", "ags", [{ key: "ewz", value: "611258" }]),
    ]);
    expect(pattern.criteria.find((criterion) => criterion.key === "ewz")).toBeUndefined();
    expect(criterionBlob(pattern)).not.toContain("742.286");
    expect(pattern.summary).toContain("keine Brain-Fakten");
  });
});

function koelnInput(): AnalysisInput {
  const base = input();
  return {
    ...base,
    region: {
      ...base.region,
      label: "Köln",
      grain: "ags5",
      geoKey: "05315",
      ags: "05315",
      plz: null,
    },
  };
}

function cityFact(
  id: string,
  geoKey: string,
  grain: string,
  signals: BrainFact["signals"],
  refPeriod = "2022-05",
): BrainFact {
  return fact({
    id,
    geoKey,
    grain,
    name: geoKey,
    title: `Gebiet ${geoKey}`,
    refPeriod,
    excerpt: `Kennzahlen ${geoKey}.`,
    signals,
  });
}

function criterionBlob(pattern: ReturnType<typeof buildHeuristicPattern>): string {
  return `${pattern.summary} ${pattern.criteria.map((criterion) => `${criterion.key} ${criterion.label} ${criterion.evidence}`).join(" ")}`;
}

import { AnalysisStoreInput } from "./types";
import { factsMatchingStoreSurroundings } from "./store-surroundings";
import { BrainFact } from "./types";

function store(overrides: Partial<AnalysisStoreInput> = {}): AnalysisStoreInput {
  return {
    id: "7",
    label: null,
    street: "Marienplatz 1",
    postalCode: "80331",
    city: "München",
    lon: null,
    lat: null,
    points: [],
    changes: [],
    ...overrides,
  };
}

function fact(overrides: Partial<BrainFact> = {}): BrainFact {
  return {
    id: "1",
    geoKey: "80331",
    grain: "plz5",
    title: "PLZ 80331",
    name: "München",
    refPeriod: "2022",
    excerpt: "Unfälle",
    distance: null,
    matchedBy: "store",
    signals: [{ key: "unfaelle_gesamt", value: "12" }],
    ...overrides,
  };
}

describe("factsMatchingStoreSurroundings", () => {
  it("keeps store PLZ facts and drops Zielregion-only keys", () => {
    const input = {
      region: {
        label: "München",
        grain: "ags" as const,
        geoKey: "09162000",
        ags: "09162000",
        plz: null,
        lon: null,
        lat: null,
        bounds: null,
        geometry: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      stores: [store()],
      revenueDirection: "up" as const,
      capturedAt: "2026-04-01T00:00:00.000Z",
    };
    const kept = factsMatchingStoreSurroundings(input, [
      fact(),
      fact({ id: "2", geoKey: "09162000", grain: "ags", matchedBy: "region" }),
      fact({ id: "3", geoKey: "05315000", grain: "ags", matchedBy: "region" }),
    ]);
    expect(kept.map((item) => item.geoKey)).toEqual(["80331"]);
  });

  it("includes extra Gemeinde/Kreis keys of the store, not the Zielregion", () => {
    const input = {
      region: {
        label: "Köln",
        grain: "ags5" as const,
        geoKey: "05315",
        ags: "05315",
        plz: null,
        lon: null,
        lat: null,
        bounds: null,
        geometry: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      stores: [store({ postalCode: "50667" })],
      revenueDirection: "up" as const,
      capturedAt: "2026-04-01T00:00:00.000Z",
    };
    const kept = factsMatchingStoreSurroundings(
      input,
      [
        fact({ geoKey: "09162000", grain: "ags", matchedBy: "region" }),
        fact({ id: "g", geoKey: "05315000", grain: "ags", matchedBy: "region" }),
      ],
      ["05315000", "05315"],
    );
    expect(kept.map((item) => item.geoKey)).toEqual(["05315000"]);
  });
});

import { DatabaseService } from "../database/database.service";
import { AddressPairService, placeKeys, sharedFrom } from "./address-pair.service";
import { GEMEINDE_TOPIC_IDS, KREIS_TOPIC_IDS, LAND_TOPIC_IDS } from "./topics";

const leftInput = { street: "Marienplatz 1", postalCode: "80331", city: "München" };
const otherStreet = { street: "Kaufingerstraße 4", postalCode: "80331", city: "München" };
const berlinInput = { street: "Alexanderplatz 1", postalCode: "10178", city: "Berlin" };

describe("AddressPairService", () => {
  const queryReadingFeatures = jest.fn();
  let service: AddressPairService;

  beforeEach(() => {
    queryReadingFeatures.mockReset();
    service = new AddressPairService({ queryReadingFeatures } as unknown as DatabaseService);
  });

  it("echoes the submitted labels and ignores street when looking up numbers", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      if (sql.includes("geo_ref_plz")) return { rows: [plzRow("80331", "09162000", "09162", "09")] };
      if (sql.includes("geo_ref_admin")) return { rows: adminRows() };
      if (sql.includes("location_feature_docs")) {
        return {
          rows: [
            feature({ theme: "ba_pendler", grain: "ags", key: "09162000", metadata: { count: 12 } }),
            feature({ theme: "ba_pendler", grain: "ags5", key: "09162", metadata: { count: 40 } }),
          ],
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    });

    const result = await service.evaluate({ left: leftInput, right: otherStreet });
    expect(result.left.input).toEqual(leftInput);
    expect(result.right.input).toEqual(otherStreet);
    expect(result.left.resolution).toBe("resolved");
    expect(result.right.resolution).toBe("resolved");
    expect(result.left.gemeinde).toEqual({ name: "München" });
    expect(result.left.kreis).toEqual({ name: "München, Landeshauptstadt" });
    expect(result.left.land).toEqual({ name: "Bayern" });
    expect(present(result.left, "pendler", "gemeinde")).toEqual({ count: 12 });
    expect(present(result.right, "pendler", "gemeinde")).toEqual({ count: 12 });
    expect(present(result.left, "pendler", "kreis")).toEqual({ count: 40 });
    expect(result.shared).toEqual(
      expect.arrayContaining([
        { id: "pendler", level: "gemeinde", left: { count: 12 }, right: { count: 12 } },
        { id: "pendler", level: "kreis", left: { count: 40 }, right: { count: 40 } },
      ]),
    );
    expect(queryReadingFeatures.mock.calls.some((call) => String(call[1]?.[0]).includes("Kaufinger"))).toBe(false);
  });

  it("marks a PLZ unknown when it does not resolve to exactly one Gemeinde and Kreis", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      if (sql.includes("geo_ref_plz")) {
        return {
          rows: [
            plzRow("00000", "09162000", "09162", "09"),
            plzRow("00000", "11000000", "11000", "11"),
          ],
        };
      }
      if (sql.includes("geo_ref_admin")) return { rows: adminRows() };
      throw new Error(`unexpected sql: ${sql}`);
    });

    const result = await service.evaluate({
      left: { street: "Nirgendwo 1", postalCode: "00000", city: "Nirgends" },
      right: berlinInput,
    });
    expect(result.left).toEqual({
      input: { street: "Nirgendwo 1", postalCode: "00000", city: "Nirgends" },
      resolution: "unknown",
      gemeinde: null,
      kreis: null,
      land: null,
      topics: [],
    });
    expect(result.left.gemeinde).toBeNull();
    expect(queryReadingFeatures.mock.calls.some((call) => String(call[0]).includes("location_feature_docs"))).toBe(
      false,
    );
  });

  it("keeps land null when the Land admin row is missing", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      if (sql.includes("geo_ref_plz")) return { rows: [plzRow("80331", "09162000", "09162", "09")] };
      if (sql.includes("geo_ref_admin")) {
        return {
          rows: [
            { geo_ags: "09162000", name: "München" },
            { geo_ags: "09162", name: "München, Landeshauptstadt" },
          ],
        };
      }
      if (sql.includes("location_feature_docs")) return { rows: [] };
      throw new Error(`unexpected sql: ${sql}`);
    });

    const result = await service.evaluate({ left: leftInput, right: leftInput });
    expect(result.left.resolution).toBe("resolved");
    expect(result.left.gemeinde).toEqual({ name: "München" });
    expect(result.left.land).toBeNull();
  });

  it("does not invent a place name when the admin row is missing", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      if (sql.includes("geo_ref_plz")) return { rows: [plzRow("80331", "09162000", "09162", "09")] };
      if (sql.includes("geo_ref_admin")) return { rows: [] };
      throw new Error(`unexpected sql: ${sql}`);
    });

    const result = await service.evaluate({ left: leftInput, right: leftInput });
    expect(result.left.resolution).toBe("unknown");
    expect(result.left.gemeinde).toBeNull();
    expect(result.left.topics).toEqual([]);
  });

  it("returns every fixed topic and omits value on absent rows", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      if (sql.includes("geo_ref_plz")) {
        return {
          rows: [plzRow("80331", "09162000", "09162", "09"), plzRow("10178", "11000000", "11000", "11")],
        };
      }
      if (sql.includes("geo_ref_admin")) return { rows: adminRows() };
      if (sql.includes("location_feature_docs")) {
        return {
          rows: [
            feature({ theme: "zensus2022", grain: "ags", key: "09162000", metadata: { personen: 1488202 } }),
            feature({ theme: "zensus_gw_gebaeude", grain: "ags", key: "ags:09162000", metadata: { gebaeude: 1840 } }),
            feature({ theme: "ba_alo", grain: "ags", key: "09162", metadata: { arbeitslose: 21000 } }),
            feature({ theme: "ba_alo", grain: "ags", key: "09162000", metadata: { arbeitslose: 21000 } }),
            feature({
              theme: "breitband_gitter",
              grain: "grid100",
              key: "09162000",
              metadata: { cells: 1 },
            }),
            feature({ theme: "uba_luft", grain: "other", key: "09", metadata: { no2: 12 } }),
          ],
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    });

    const result = await service.evaluate({ left: leftInput, right: berlinInput });
    const leftIds = result.left.topics.map((topic) => `${topic.level}:${topic.id}`);
    expect(leftIds).toEqual([
      ...GEMEINDE_TOPIC_IDS.map((id) => `gemeinde:${id}`),
      ...KREIS_TOPIC_IDS.map((id) => `kreis:${id}`),
      ...LAND_TOPIC_IDS.map((id) => `land:${id}`),
    ]);

    const zensus = result.left.topics.find((topic) => topic.id === "zensus2022" && topic.level === "gemeinde");
    expect(zensus).toEqual({
      id: "zensus2022",
      level: "gemeinde",
      status: "present",
      value: { personen: 1488202, gebaeude: 1840 },
    });

    const absent = result.left.topics.find((topic) => topic.id === "breitband");
    expect(absent).toEqual({ id: "breitband", level: "gemeinde", status: "absent" });
    expect(absent).not.toHaveProperty("value");

    expect(present(result.left, "arbeitsmarkt", "kreis")).toEqual({ arbeitslose: 21000 });
    expect(result.left.topics.some((topic) => topic.id === "arbeitsmarkt" && topic.level === "gemeinde")).toBe(false);
    expect(result.left.topics.some((topic) => topic.id === "uba_luft" || topic.id === "breitband_gitter")).toBe(false);

    expect(result.shared).toEqual([]);
    expect(result.right.resolution).toBe("resolved");
    expect(result.right.topics.every((topic) => topic.status === "absent")).toBe(true);
  });

  it("treats a missing Brain catalog as unknown, not as invented places", async () => {
    const missing = Object.assign(new Error('relation "geo.geo_ref_plz" does not exist'), { code: "42P01" });
    queryReadingFeatures.mockRejectedValue(missing);

    const result = await service.evaluate({ left: leftInput, right: berlinInput });
    expect(result.left.resolution).toBe("unknown");
    expect(result.right.resolution).toBe("unknown");
    expect(result.shared).toEqual([]);
  });

  it("does not mark a Gemeinde Arbeitsmarkt row as present", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      if (sql.includes("geo_ref_plz")) return { rows: [plzRow("80331", "09161123", "09161", "09")] };
      if (sql.includes("geo_ref_admin")) {
        return {
          rows: [
            { geo_ags: "09161123", name: "Beispieldorf" },
            { geo_ags: "09161", name: "Dachau" },
            { geo_ags: "09", name: "Bayern" },
          ],
        };
      }
      if (sql.includes("location_feature_docs")) {
        return {
          rows: [feature({ theme: "ba_alo", grain: "ags", key: "09161123", metadata: { arbeitslose: 1 } })],
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    });

    const result = await service.evaluate({
      left: { street: "A 1", postalCode: "80331", city: "Dachau" },
      right: { street: "B 1", postalCode: "80331", city: "Dachau" },
    });
    expect(result.left.topics.find((topic) => topic.id === "arbeitsmarkt")).toEqual({
      id: "arbeitsmarkt",
      level: "kreis",
      status: "absent",
    });
  });
});

describe("address-pair helpers", () => {
  it("builds shared topics only from present rows on both sides", () => {
    const left = {
      input: leftInput,
      resolution: "resolved" as const,
      gemeinde: { name: "München" },
      kreis: { name: "München" },
      land: { name: "Bayern" },
      topics: [
        { id: "pendler", level: "gemeinde" as const, status: "present" as const, value: { count: 12 } },
        { id: "breitband", level: "gemeinde" as const, status: "absent" as const },
      ],
    };
    const right = {
      input: berlinInput,
      resolution: "resolved" as const,
      gemeinde: { name: "Berlin" },
      kreis: { name: "Berlin" },
      land: { name: "Berlin" },
      topics: [{ id: "pendler", level: "gemeinde" as const, status: "present" as const, value: { count: 8 } }],
    };
    expect(sharedFrom(left, right)).toEqual([
      { id: "pendler", level: "gemeinde", left: { count: 12 }, right: { count: 8 } },
    ]);
  });

  it("does not use a Gemeinde AGS as the Kreis Arbeitsmarkt key", () => {
    const keys = placeKeys("09161123", "09161", "09");
    expect(keys.kreis).toEqual(expect.arrayContaining(["09161", "ags:09161", "ags5:09161", "09161000"]));
    expect(keys.kreis).not.toContain("09161123");
    expect(keys.gemeinde).toEqual(expect.arrayContaining(["09161123", "ags:09161123"]));
    expect(keys.gemeinde).not.toContain("09161");
  });
});

function present(
  side: { topics: Array<{ id: string; level: string; status: string; value?: unknown }> },
  id: string,
  level: string,
): unknown {
  const topic = side.topics.find((item) => item.id === id && item.level === level);
  expect(topic?.status).toBe("present");
  return topic?.value;
}

function plzRow(plz: string, geo_ags: string, geo_ags5: string, geo_land: string) {
  return { plz, geo_ags, geo_ags5, geo_land };
}

function adminRows() {
  return [
    { geo_ags: "09162000", name: "München" },
    { geo_ags: "09162", name: "München, Landeshauptstadt" },
    { geo_ags: "09", name: "Bayern" },
    { geo_ags: "11000000", name: "Berlin" },
    { geo_ags: "11000", name: "Berlin" },
    { geo_ags: "11", name: "Berlin" },
  ];
}

function feature(input: { theme: string; grain: string; key: string; metadata: unknown; period?: string }) {
  return {
    source_theme: input.theme,
    grain: input.grain,
    geo_key: input.key,
    metadata: input.metadata,
    ref_period: input.period ?? "2025-12",
  };
}

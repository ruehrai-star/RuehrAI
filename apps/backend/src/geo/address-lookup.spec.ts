import { ADDRESS_LOOKUP_SQL, queryAddressPin, queryPlzCentroid } from "./address-lookup";

describe("Data-Scout address lookup", () => {
  const query = jest.fn();

  beforeEach(() => {
    query.mockReset();
  });

  it("looks up strasse, hnr, and plz on geo_ref_address", async () => {
    query.mockResolvedValue({ rows: [{ lon: "13.31", lat: "52.48" }] });
    await expect(queryAddressPin(query, "Sendlinger Str. 12 a", "12247")).resolves.toEqual({
      lon: 13.31,
      lat: 52.48,
    });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toBe(ADDRESS_LOOKUP_SQL);
    expect(sql).toContain("FROM public.geo_ref_address");
    expect(sql).toContain("plz = $1");
    expect(params[0]).toBe("12247");
    expect(params[1]).toEqual(
      expect.arrayContaining(["sendlinger str.", "sendlinger straße", "sendlinger strasse"]),
    );
    expect(params[2]).toEqual(expect.arrayContaining(["12a"]));
    expect(params[3]).toBe("12a");
  });

  it("does not query when the street has no house number", async () => {
    await expect(queryAddressPin(query, "Unter den Linden", "10115")).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("returns null when Data-Scout fails", async () => {
    query.mockResolvedValue(null);
    await expect(queryAddressPin(query, "Hauptstraße 1", "10115")).resolves.toBeNull();
  });

  it("reads the geo_ref_plz centroid", async () => {
    query.mockResolvedValue({ rows: [{ lon: 13.387, lat: 52.532 }] });
    await expect(queryPlzCentroid(query, "10115")).resolves.toEqual({ lon: 13.387, lat: 52.532 });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("FROM public.geo_ref_plz");
    expect(sql).toContain("centroid_lon");
    expect(params).toEqual(["10115"]);
  });
});

import { ADMIN_OUTLINE_SQL, BEZIRK_OUTLINE_SQL, queryAdminOutline, queryBezirkOutline } from "./region-outline-lookup";

const steglitz = {
  type: "MultiPolygon",
  coordinates: [
    [
      [
        [13.1, 52.4],
        [13.3, 52.4],
        [13.3, 52.5],
        [13.1, 52.5],
        [13.1, 52.4],
      ],
    ],
  ],
};

describe("Data-Scout region outlines", () => {
  it("reads a Berlin Bezirk as GeoJSON in WGS84", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{ geometry: steglitz, lon: "13.25", lat: "52.43" }],
    });
    await expect(queryBezirkOutline(query, "11000006")).resolves.toEqual({
      geometry: steglitz,
      point: { lon: 13.25, lat: 52.43 },
    });
    expect(query).toHaveBeenCalledWith(BEZIRK_OUTLINE_SQL, ["11000006"]);
    expect(BEZIRK_OUTLINE_SQL).toContain("public.geo_ref_bezirk");
    expect(BEZIRK_OUTLINE_SQL).toContain("ST_AsGeoJSON");
    expect(BEZIRK_OUTLINE_SQL).toContain("4326");
    expect(BEZIRK_OUTLINE_SQL).not.toContain(";");
  });

  it("does not query geo_ref_bezirk for a gemeinde or an alias", async () => {
    const query = jest.fn();
    await expect(queryBezirkOutline(query, "09162000")).resolves.toBeNull();
    await expect(queryBezirkOutline(query, "11006006")).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("transforms a Gemeinde or Kreis outline to WGS84", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{ geometry: JSON.stringify(steglitz), lon: 11.57, lat: 48.14 }],
    });
    const hit = await queryAdminOutline(query, "09162000");
    expect(hit?.geometry).toEqual(steglitz);
    expect(hit?.point).toEqual({ lon: 11.57, lat: 48.14 });
    expect(query).toHaveBeenCalledWith(ADMIN_OUTLINE_SQL, ["09162000"]);
    expect(ADMIN_OUTLINE_SQL).toContain("public.geo_ref_admin");
    expect(ADMIN_OUTLINE_SQL).toContain("ST_Transform");
    expect(ADMIN_OUTLINE_SQL).toContain("3035");
    expect(ADMIN_OUTLINE_SQL).not.toContain(";");
  });

  it("returns null when Data-Scout fails", async () => {
    const query = jest.fn().mockResolvedValue(null);
    await expect(queryAdminOutline(query, "09162")).resolves.toBeNull();
  });
});
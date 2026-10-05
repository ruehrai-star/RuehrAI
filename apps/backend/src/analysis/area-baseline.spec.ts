import {
  AREA_SNAPSHOT_YEAR,
  areaDivisor,
  areaKeyAliases,
  buildAreaBaselineIndex,
  catalogSeriesBaseline,
  findAreaBaseline,
  parseAreaBaselineRow,
  parseMetricCatalogRow,
} from "./area-baseline";

describe("area-baseline", () => {
  it("maps catalog columns and never treats missing EW as a scale of 1", () => {
    expect(catalogSeriesBaseline({ sourceTheme: "kba_elektro_pkw", recommendedBaseline: "einwohner", unitHint: "per_1000_einwohner" })).toEqual({
      baseline: "per_1000_inhabitants",
      scale: 1000,
    });
    expect(catalogSeriesBaseline({ sourceTheme: "kba_elektro_pkw", recommendedBaseline: "einwohner", unitHint: "per_capita_einwohner" })).toEqual({
      baseline: "per_1000_inhabitants",
      scale: 1,
    });
    expect(catalogSeriesBaseline({ sourceTheme: "boris_brw", recommendedBaseline: "flaeche_km2", unitHint: "per_km2" })).toEqual({
      baseline: "per_km2",
      scale: 1,
    });
    expect(catalogSeriesBaseline({ sourceTheme: "zensus_gw_wohnungen", recommendedBaseline: "haushalte", unitHint: "per_1000_haushalte" })).toEqual({
      baseline: "per_household",
      scale: 1000,
    });
  });

  it("parses Brain rows and aliases analysis keys", () => {
    const row = parseAreaBaselineRow({
      geo_key: "11000000",
      grain: "ags",
      ref_year: "2025",
      einwohner: "3700577",
      flaeche_km2: "891.71",
      haushalte: null,
      einwohner_method: "official",
      haushalte_method: null,
      flaeche_method: "geom",
    });
    expect(row).toMatchObject({
      geoKey: "11000000",
      refYear: 2025,
      einwohner: 3_700_577,
      flaecheKm2: 891.71,
      einwohnerMethod: "official",
      flaecheMethod: "geom",
    });
    expect(areaKeyAliases("ags:11000000")).toEqual(expect.arrayContaining(["ags:11000000", "11000000"]));
    expect(areaKeyAliases("lor:plr:01100101")).toEqual(["lor:plr:01100101"]);
  });

  it("uses the exact year for Einwohner and the 2026 snapshot only for km²", () => {
    const index = buildAreaBaselineIndex([
      {
        geoKey: "10115",
        grain: "plz5",
        refYear: 2024,
        einwohner: null,
        flaecheKm2: null,
        haushalte: null,
        einwohnerMethod: "missing",
        haushalteMethod: null,
        flaecheMethod: null,
      },
      {
        geoKey: "10115",
        grain: "plz5",
        refYear: AREA_SNAPSHOT_YEAR,
        einwohner: 3992,
        flaecheKm2: 2.4,
        haushalte: null,
        einwohnerMethod: "estimate_address",
        haushalteMethod: null,
        flaecheMethod: "geom",
      },
    ]);
    expect(findAreaBaseline(index, ["10115"], 2024, "einwohner")?.einwohnerMethod).toBe("missing");
    expect(areaDivisor(findAreaBaseline(index, ["10115"], 2024, "einwohner"), "einwohner")).toBeNull();
    expect(areaDivisor(findAreaBaseline(index, ["10115"], 2024, "flaeche_km2"), "flaeche_km2")).toEqual({
      value: 2.4,
      method: "geom",
    });
    expect(parseMetricCatalogRow({ source_theme: "breitband_gitter", recommended_baseline: "flaeche_km2", unit_hint: "per_km2" })).toMatchObject({
      sourceTheme: "breitband_gitter",
      recommendedBaseline: "flaeche_km2",
    });
  });

  it("rejects missing or non-positive divisors", () => {
    expect(
      areaDivisor(
        {
          geoKey: "grid:1",
          grain: "grid100",
          refYear: 2026,
          einwohner: null,
          flaecheKm2: 0.01,
          haushalte: null,
          einwohnerMethod: "missing",
          haushalteMethod: null,
          flaecheMethod: "fixed_grid",
        },
        "einwohner",
      ),
    ).toBeNull();
    expect(
      areaDivisor(
        {
          geoKey: "grid:1",
          grain: "grid100",
          refYear: 2026,
          einwohner: 12,
          flaecheKm2: 0.01,
          haushalte: null,
          einwohnerMethod: "estimate_address",
          haushalteMethod: null,
          flaecheMethod: "fixed_grid",
        },
        "einwohner",
      ),
    ).toEqual({ value: 12, method: "estimate_address" });
    expect(
      areaDivisor(
        {
          geoKey: "grid:1",
          grain: "grid100",
          refYear: 2026,
          einwohner: 12,
          flaecheKm2: 0.01,
          haushalte: null,
          einwohnerMethod: "estimate_address",
          haushalteMethod: null,
          flaecheMethod: "fixed_grid",
        },
        "flaeche_km2",
      ),
    ).toEqual({ value: 0.01, method: "fixed_grid" });
  });
});

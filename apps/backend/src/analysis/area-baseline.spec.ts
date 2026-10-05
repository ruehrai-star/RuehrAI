import {
  AREA_SNAPSHOT_YEAR,
  areaDivisor,
  areaKeyAliases,
  buildAreaBaselineIndex,
  catalogSeriesBaseline,
  findAreaBaseline,
  parseAreaBaselineRow,
  parseMetricCatalogRow,
  parsePreferredEw,
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
    expect(areaKeyAliases("dwd1km:181:0")).toEqual(["dwd1km:181:0"]);
  });

  it("keeps Hanau attrs.ags_alias_of and follows preferred_ew to the Zensus row", () => {
    const hanau = parseAreaBaselineRow({
      geo_key: "06415000",
      grain: "ags",
      ref_year: 2025,
      einwohner: "98582",
      flaeche_km2: "77.16",
      haushalte: null,
      einwohner_method: "official",
      haushalte_method: null,
      flaeche_method: "geom",
      attrs: { ags_alias_of: "06435014" },
    });
    expect(hanau).toMatchObject({
      einwohner: 98_582,
      einwohnerMethod: "official",
      agsAliasOf: "06435014",
    });
    expect(hanau?.attrs).toMatchObject({ ags_alias_of: "06435014" });
    expect(parsePreferredEw({ preferred_ew: 2022 })).toEqual({ year: 2022, method: null });
    expect(parsePreferredEw({ preferred_ew: "official_zensus2022_grid" })).toEqual({
      year: 2022,
      method: "official_zensus2022_grid",
    });

    const index = buildAreaBaselineIndex([
      {
        geoKey: "10115",
        grain: "plz5",
        refYear: 2026,
        einwohner: 3992,
        flaecheKm2: 2.4,
        haushalte: null,
        einwohnerMethod: "estimate_address",
        haushalteMethod: null,
        flaecheMethod: "geom",
        attrs: { preferred_ew: 2022 },
      },
      {
        geoKey: "10115",
        grain: "plz5",
        refYear: 2022,
        einwohner: 26_764,
        flaecheKm2: 2.4,
        haushalte: null,
        einwohnerMethod: "estimate_zensus2022_grid_sum",
        haushalteMethod: null,
        flaecheMethod: "geom",
      },
    ]);
    expect(findAreaBaseline(index, ["10115"], 2026, "einwohner")).toMatchObject({
      einwohner: 26_764,
      einwohnerMethod: "estimate_zensus2022_grid_sum",
    });
    expect(findAreaBaseline(index, ["10115"], 2024, "einwohner")).toMatchObject({
      einwohnerMethod: "estimate_zensus2022_grid_sum",
    });
    expect(areaDivisor(findAreaBaseline(index, ["10115"], 2026, "einwohner"), "einwohner")).toEqual({
      value: 26_764,
      method: "estimate_zensus2022_grid_sum",
    });
  });

  it("passes official_zensus2022_grid through and does not remap it to estimate_address", () => {
    const index = buildAreaBaselineIndex([
      {
        geoKey: "CRS3035RES100mN1",
        grain: "grid100",
        refYear: 2022,
        einwohner: 84,
        flaecheKm2: 0.01,
        haushalte: null,
        einwohnerMethod: "official_zensus2022_grid",
        haushalteMethod: null,
        flaecheMethod: "fixed_grid",
      },
      {
        geoKey: "CRS3035RES100mN1",
        grain: "grid100",
        refYear: 2026,
        einwohner: 12,
        flaecheKm2: 0.01,
        haushalte: null,
        einwohnerMethod: "estimate_address",
        haushalteMethod: null,
        flaecheMethod: "fixed_grid",
        attrs: { preferred_ew: "official_zensus2022_grid" },
      },
    ]);
    expect(findAreaBaseline(index, ["CRS3035RES100mN1"], 2026, "einwohner")).toMatchObject({
      einwohner: 84,
      einwohnerMethod: "official_zensus2022_grid",
    });
    expect(areaDivisor(findAreaBaseline(index, ["CRS3035RES100mN1"], 2024, "einwohner"), "einwohner")).toEqual({
      value: 84,
      method: "official_zensus2022_grid",
    });
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

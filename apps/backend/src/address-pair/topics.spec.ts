import {
  FIXED_TOPICS,
  GEMEINDE_TOPIC_IDS,
  KREIS_TOPIC_IDS,
  LAND_TOPIC_IDS,
  TOPIC_SOURCE_THEMES,
  grainMatchesTopic,
  sourceThemesForSeries,
  sourceThemesForTopics,
} from "./topics";

describe("address-pair topic catalog", () => {
  it("always returns the fixed Gemeinde, Kreis, and Land lists", () => {
    expect([...GEMEINDE_TOPIC_IDS]).toEqual([
      "pendler",
      "breitband",
      "bundestagswahl",
      "gerda",
      "gemeindeverzeichnis",
      "zensus2022",
      "bevoelkerung",
      "wanderungen",
      "unfallatlas",
      "rwi-redx",
      "wwk",
      "boris",
      "pks",
      "open-nrw",
    ]);
    expect([...KREIS_TOPIC_IDS]).toEqual(["pks", "destatis", "vgrdl", "pendler", "unfallatlas", "arbeitsmarkt"]);
    expect([...LAND_TOPIC_IDS]).toEqual(["pendler", "dehoga", "kba", "baugenehmigungen", "kmk"]);
    expect(FIXED_TOPICS).toHaveLength(GEMEINDE_TOPIC_IDS.length + KREIS_TOPIC_IDS.length + LAND_TOPIC_IDS.length);
  });

  it("keeps Pendler, PKS, and Unfallatlas as separate levels", () => {
    const keys = FIXED_TOPICS.map((topic) => `${topic.level}:${topic.id}`);
    expect(keys.filter((key) => key.endsWith(":pendler")).sort()).toEqual([
      "gemeinde:pendler",
      "kreis:pendler",
      "land:pendler",
    ]);
    expect(keys.filter((key) => key.endsWith(":pks")).sort()).toEqual(["gemeinde:pks", "kreis:pks"]);
    expect(keys.filter((key) => key.endsWith(":unfallatlas")).sort()).toEqual([
      "gemeinde:unfallatlas",
      "kreis:unfallatlas",
    ]);
  });

  it("never places Arbeitsmarkt on Gemeinde", () => {
    expect(FIXED_TOPICS.some((topic) => topic.id === "arbeitsmarkt" && topic.level === "gemeinde")).toBe(false);
    expect(grainMatchesTopic("ags", "arbeitsmarkt", "gemeinde")).toBe(false);
    expect(grainMatchesTopic("ags", "arbeitsmarkt", "kreis")).toBe(true);
  });

  it("does not query grid, weather, air, or plz8 themes", () => {
    const themes = sourceThemesForTopics();
    expect(themes).not.toEqual(expect.arrayContaining(["breitband_gitter", "dwd_temp_1km", "uba_luft"]));
    expect(grainMatchesTopic("grid100", "breitband", "gemeinde")).toBe(false);
    expect(grainMatchesTopic("plz8", "pendler", "gemeinde")).toBe(false);
    expect(grainMatchesTopic("address", "wwk", "gemeinde")).toBe(false);
  });

  it("maps Unfallatlas Gebiet and Destatis Kreis series themes without mixing them into other topics", () => {
    const themes = sourceThemesForSeries();
    expect(themes).toEqual(
      expect.arrayContaining([
        "unfallatlas_gebiet",
        "destatis_wohnungen",
        "destatis_kfz_bestand",
        "destatis_bevoelkerung_alter",
        "kba_elektro_pkw",
        "ba_sgb2",
        "kba_neuzulassungen",
        "kba_bestand",
        "hamburg_stadtteil_regionalstatistik",
        "muenchen_indikatorenatlas",
        "berlin_lor_ewr_bevoelkerung",
        "koeln_statistischer_datenkatalog",
        "leipzig_lis_ortsteil",
        "duesseldorf_bevoelkerung_stadtteile",
        "essen_bevoelkerung_stadtteile",
        "frankfurt_demographie_stadtteile",
      ]),
    );
    expect(TOPIC_SOURCE_THEMES.kba).toEqual(["kba_besitz"]);
    expect(TOPIC_SOURCE_THEMES.destatis).toEqual(["destatis"]);
    expect(TOPIC_SOURCE_THEMES.unfallatlas).toEqual(["unfallatlas", "unfallatlas_gebiet"]);
    expect(grainMatchesTopic("other", "unfallatlas", "gemeinde")).toBe(false);
    expect(grainMatchesTopic("ags5", "destatis_wohnungen", "kreis")).toBe(true);
    expect(grainMatchesTopic("ags", "kba_elektro_pkw", "gemeinde")).toBe(true);
    expect(grainMatchesTopic("ags5", "ba_sgb2", "kreis")).toBe(true);
    expect(grainMatchesTopic("ags", "ba_sgb2", "gemeinde")).toBe(false);
    expect(grainMatchesTopic("other", "kba_neuzulassungen", "land")).toBe(true);
    expect(grainMatchesTopic("ags", "hamburg_stadtteil_regionalstatistik", "gemeinde")).toBe(false);
    expect(grainMatchesTopic("ags", "berlin_lor_ewr_bevoelkerung", "gemeinde")).toBe(false);
    expect(grainMatchesTopic("ags", "muenchen_indikatorenatlas", "gemeinde")).toBe(true);
  });

  it("maps every catalog id to a Brain source_theme that already exists", () => {
    for (const topic of FIXED_TOPICS) {
      expect(TOPIC_SOURCE_THEMES[topic.id].length).toBeGreaterThan(0);
    }
  });
});

export const TOPIC_LEVELS = ["gemeinde", "kreis", "land"] as const;
export type TopicLevel = (typeof TOPIC_LEVELS)[number];

export const TOPIC_STATUSES = ["present", "absent"] as const;
export type TopicStatus = (typeof TOPIC_STATUSES)[number];

export const GEMEINDE_TOPIC_IDS = [
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
] as const;

export const KREIS_TOPIC_IDS = [
  "pks",
  "destatis",
  "vgrdl",
  "pendler",
  "unfallatlas",
  "arbeitsmarkt",
] as const;

export const LAND_TOPIC_IDS = ["pendler", "dehoga", "kba", "baugenehmigungen", "kmk"] as const;

export type GemeindeTopicId = (typeof GEMEINDE_TOPIC_IDS)[number];
export type KreisTopicId = (typeof KREIS_TOPIC_IDS)[number];
export type LandTopicId = (typeof LAND_TOPIC_IDS)[number];
export type TopicId = GemeindeTopicId | KreisTopicId | LandTopicId;

/** Feature-doc grains that are never a Gemeinde / Kreis / Land topic. */
export const EXCLUDED_FEATURE_GRAINS = ["address", "grid100", "plz8"] as const;

/**
 * Brain `source_theme` values already loaded into `features.location_feature_docs`.
 * A topic with no mapped theme stays absent — never invent a number.
 */
export const TOPIC_SOURCE_THEMES: Record<TopicId, readonly string[]> = {
  pendler: ["ba_pendler"],
  breitband: ["breitband"],
  bundestagswahl: ["bundeswahlleiter"],
  gerda: ["gerda"],
  gemeindeverzeichnis: ["statistikportal_gv"],
  zensus2022: ["zensus2022", "zensus_gw_gebaeude", "zensus_gw_wohnungen"],
  bevoelkerung: ["regionalstatistik_bevoelkerung"],
  wanderungen: ["regionalstatistik_wanderungen"],
  unfallatlas: ["unfallatlas", "unfallatlas_gebiet"],
  "rwi-redx": ["rwi_redx"],
  wwk: ["wwk"],
  boris: ["boris_brw"],
  pks: ["bka_pks"],
  "open-nrw": ["open_nrw"],
  destatis: ["destatis"],
  vgrdl: ["vgrdl_einkommen"],
  arbeitsmarkt: ["ba_alo"],
  dehoga: ["dehoga"],
  kba: ["kba_besitz"],
  baugenehmigungen: ["destatis_baugenehmigung"],
  kmk: ["kmk"],
};

/**
 * Extra yearlySeries metrics. Address-pair keeps the fixed Gemeinde/Kreis/Land
 * lists; these Brain themes only feed AnalysisPattern.yearlySeries.
 */
export const EXTRA_SERIES_METRICS = [
  { id: "destatis_wohnungen", homeLevel: "kreis" },
  { id: "destatis_kfz_bestand", homeLevel: "kreis" },
  { id: "destatis_bevoelkerung_alter", homeLevel: "kreis" },
  { id: "kba_elektro_pkw", homeLevel: "gemeinde" },
  { id: "ba_sgb2", homeLevel: "kreis" },
  { id: "kba_neuzulassungen", homeLevel: "land" },
  { id: "kba_bestand", homeLevel: "land" },
  { id: "hamburg_stadtteil_regionalstatistik", homeLevel: "gemeinde" },
  { id: "muenchen_indikatorenatlas", homeLevel: "gemeinde" },
  { id: "berlin_lor_ewr_bevoelkerung", homeLevel: "gemeinde" },
] as const;

export type ExtraSeriesMetricId = (typeof EXTRA_SERIES_METRICS)[number]["id"];
export type SeriesMetricId = TopicId | ExtraSeriesMetricId;

export const EXTRA_SERIES_SOURCE_THEMES: Record<ExtraSeriesMetricId, readonly string[]> = {
  destatis_wohnungen: ["destatis_wohnungen"],
  destatis_kfz_bestand: ["destatis_kfz_bestand"],
  destatis_bevoelkerung_alter: ["destatis_bevoelkerung_alter"],
  kba_elektro_pkw: ["kba_elektro_pkw"],
  ba_sgb2: ["ba_sgb2"],
  kba_neuzulassungen: ["kba_neuzulassungen"],
  kba_bestand: ["kba_bestand"],
  hamburg_stadtteil_regionalstatistik: ["hamburg_stadtteil_regionalstatistik"],
  muenchen_indikatorenatlas: ["muenchen_indikatorenatlas"],
  berlin_lor_ewr_bevoelkerung: ["berlin_lor_ewr_bevoelkerung"],
};

export const EXTRA_SERIES_GRAINS: Record<ExtraSeriesMetricId, Partial<Record<TopicLevel, readonly string[]>>> = {
  destatis_wohnungen: { kreis: ["ags5"] },
  destatis_kfz_bestand: { kreis: ["ags5"] },
  destatis_bevoelkerung_alter: { kreis: ["ags5"] },
  kba_elektro_pkw: { gemeinde: ["ags"] },
  ba_sgb2: { kreis: ["ags5"] },
  kba_neuzulassungen: { land: ["other"] },
  kba_bestand: { land: ["other"] },
  // Kleinräumig: match requested Ortsteil/Bezirk/LOR keys. München Stadt is grain ags.
  hamburg_stadtteil_regionalstatistik: {},
  muenchen_indikatorenatlas: { gemeinde: ["ags"] },
  berlin_lor_ewr_bevoelkerung: {},
};

/** Grain a Brain row must have to count for that topic level. */
export const TOPIC_GRAINS: Record<TopicId, Partial<Record<TopicLevel, readonly string[]>>> = {
  pendler: { gemeinde: ["ags"], kreis: ["ags5"], land: ["other"] },
  breitband: { gemeinde: ["ags"] },
  bundestagswahl: { gemeinde: ["ags"] },
  gerda: { gemeinde: ["ags"] },
  gemeindeverzeichnis: { gemeinde: ["ags"] },
  zensus2022: { gemeinde: ["ags"] },
  bevoelkerung: { gemeinde: ["ags"] },
  wanderungen: { gemeinde: ["ags"] },
  unfallatlas: { gemeinde: ["ags"], kreis: ["ags5"] },
  // unfallatlas_gebiet lives on grain plz5 / other (ortsteil: / bezirk:).
  // Small-area yearlySeries matches those keys without this Gemeinde/Kreis map.
  "rwi-redx": { gemeinde: ["ags"] },
  wwk: { gemeinde: ["ags"] },
  boris: { gemeinde: ["ags"] },
  pks: { gemeinde: ["ags"], kreis: ["ags5"] },
  "open-nrw": { gemeinde: ["ags", "ags5", "other"] },
  destatis: { kreis: ["ags5"] },
  vgrdl: { kreis: ["ags5"] },
  // 401 Kreis rows live on grain `ags`. Never attach this theme to a Gemeinde.
  arbeitsmarkt: { kreis: ["ags", "ags5"] },
  dehoga: { land: ["other"] },
  kba: { land: ["other"] },
  baugenehmigungen: { land: ["other"] },
  kmk: { land: ["other"] },
};

export const FIXED_TOPICS: ReadonlyArray<{ id: TopicId; level: TopicLevel }> = [
  ...GEMEINDE_TOPIC_IDS.map((id) => ({ id, level: "gemeinde" as const })),
  ...KREIS_TOPIC_IDS.map((id) => ({ id, level: "kreis" as const })),
  ...LAND_TOPIC_IDS.map((id) => ({ id, level: "land" as const })),
];

export function sourceThemesForTopics(): string[] {
  return [...new Set(Object.values(TOPIC_SOURCE_THEMES).flat())];
}

export function sourceThemesForSeries(): string[] {
  return [...new Set([...sourceThemesForTopics(), ...Object.values(EXTRA_SERIES_SOURCE_THEMES).flat()])];
}

export function topicIdForTheme(theme: string, level: TopicLevel): TopicId | null {
  for (const [id, themes] of Object.entries(TOPIC_SOURCE_THEMES) as Array<[TopicId, readonly string[]]>) {
    if (!themes.includes(theme)) continue;
    const grains = TOPIC_GRAINS[id][level];
    if (grains && grains.length > 0) return id;
  }
  return null;
}

export function themeMatchesTopic(theme: string, id: SeriesMetricId): boolean {
  return themesForMetric(id).includes(theme);
}

export function grainMatchesTopic(grain: string | null, id: SeriesMetricId, level: TopicLevel): boolean {
  const allowed = grainsForMetric(id)[level];
  if (!allowed) return false;
  if (grain == null || grain === "") return true;
  if ((EXCLUDED_FEATURE_GRAINS as readonly string[]).includes(grain)) return false;
  return allowed.includes(grain);
}

function themesForMetric(id: SeriesMetricId): readonly string[] {
  if (isExtraSeriesMetric(id)) return EXTRA_SERIES_SOURCE_THEMES[id];
  return TOPIC_SOURCE_THEMES[id];
}

function grainsForMetric(id: SeriesMetricId): Partial<Record<TopicLevel, readonly string[]>> {
  if (isExtraSeriesMetric(id)) return EXTRA_SERIES_GRAINS[id];
  return TOPIC_GRAINS[id];
}

function isExtraSeriesMetric(id: string): id is ExtraSeriesMetricId {
  return id in EXTRA_SERIES_SOURCE_THEMES;
}

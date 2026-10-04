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
  unfallatlas: ["unfallatlas"],
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

export function topicIdForTheme(theme: string, level: TopicLevel): TopicId | null {
  for (const [id, themes] of Object.entries(TOPIC_SOURCE_THEMES) as Array<[TopicId, readonly string[]]>) {
    if (!themes.includes(theme)) continue;
    const grains = TOPIC_GRAINS[id][level];
    if (grains && grains.length > 0) return id;
  }
  return null;
}

export function themeMatchesTopic(theme: string, id: TopicId): boolean {
  return TOPIC_SOURCE_THEMES[id].includes(theme);
}

export function grainMatchesTopic(grain: string | null, id: TopicId, level: TopicLevel): boolean {
  const allowed = TOPIC_GRAINS[id][level];
  if (!allowed) return false;
  if (grain == null || grain === "") return true;
  if ((EXCLUDED_FEATURE_GRAINS as readonly string[]).includes(grain)) return false;
  return allowed.includes(grain);
}

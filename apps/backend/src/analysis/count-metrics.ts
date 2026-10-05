/**
 * Count-like metrics (dwellings, population, people, vehicles, SGB2 BG/PERS, …)
 * vs rates/shares. Shared by yearlySeries, Brain fact signals, and heuristic
 * evidence so interpolated Brain floats do not show as „413.771,33“.
 */

const RATE_TOKEN =
  /anteil|quote|rate|share|pct|percent|prozent|dichte|ratio|index|miete|preis|kaufkraft|einkommen|flaeche|wohnflaeche|jeew|je1000|_qm$|qm_/i;

const RATE_UNIT = /(^|_)(eur|euro|usd|je|pro|per)(_|$)/i;

const COUNT_TOKEN =
  /wohnungen|dwellings|gebaeude|bauten|haushalte|einwohner|einwohnerzahl|personen|arbeitslose|bedarfsgemeinschaft|leistungsberechtigte|zuzuege|fortzuege|unfaelle|pendler/i;

const COUNT_EXACT = new Set([
  "bg",
  "bedarfsgemeinschaften",
  "pers",
  "personen_sgb2",
  "personen",
  "elb",
  "erwerbsfaehige_leistungsberechtigte",
  "erwerbsfaehige",
  "nef",
  "nicht_erwerbsfaehige_leistungsberechtigte",
  "nicht_erwerbsfaehige",
  "rlb",
  "regelleistungsberechtigte",
  "leistungsberechtigte",
  "wohnungen",
  "dwellings",
  "gebaeude",
  "bauten",
  "raeume",
  "ewz",
  "einwohner",
  "einwohnerzahl",
  "einw",
  "bev_insgesamt",
  "bevoelkerung",
  "haushalte",
  "households",
  "count",
  "anzahl",
  "arbeitslose",
  "arbeitslose_insgesamt",
  "svb_wohnort",
  "einpendler",
  "auspendler",
  "zuzuege",
  "fortzuege",
  "saldo",
  "pkw_elektro",
  "pkw_insgesamt",
  "pkw_bev",
  "pkw_phev",
  "pkw",
  "kfz",
  "kfz_insgesamt",
  "unfaelle_gesamt",
  "unfaelle",
  "insgesamt",
  "gesamt",
]);

/** Themes whose preferred series value is a count, not a rate. */
const COUNT_METRIC_IDS = new Set([
  "destatis_wohnungen",
  "bevoelkerung",
  "destatis",
  "destatis_bevoelkerung_alter",
  "ba_sgb2",
  "unfallatlas",
  "wanderungen",
  "pendler",
  "kba",
  "kba_elektro_pkw",
  "kba_neuzulassungen",
  "kba_bestand",
  "destatis_kfz_bestand",
  "baugenehmigungen",
  "arbeitsmarkt",
  "zensus2022",
  "gerda",
  "pks",
]);

export function leafMetricKey(key: string): string {
  const trimmed = key.trim();
  const last = trimmed.split(".").pop();
  return last && last.length > 0 ? last : trimmed;
}

export function isRateLikeKey(key: string): boolean {
  const leaf = normalizeKey(leafMetricKey(key));
  if (!leaf) return false;
  return RATE_TOKEN.test(leaf) || RATE_UNIT.test(leaf);
}

export function isCountMetricKey(key: string, metricId?: string): boolean {
  const leaf = normalizeKey(leafMetricKey(key));
  if (isRateLikeKey(key) || (metricId && isRateLikeKey(metricId))) return false;
  if (leaf && (COUNT_EXACT.has(leaf) || COUNT_TOKEN.test(leaf))) return true;
  if (metricId && COUNT_METRIC_IDS.has(metricId)) return true;
  return false;
}

export function roundCountMetricValue(key: string, value: number, metricId?: string): number {
  if (!Number.isFinite(value)) return value;
  if (!isCountMetricKey(key, metricId)) return value;
  return Math.round(value);
}

export function formatMetricNumber(key: string, value: number, metricId?: string): string {
  const rounded = roundCountMetricValue(key, value, metricId);
  const digits = isCountMetricKey(key, metricId) ? 0 : 2;
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: digits }).format(rounded);
}

function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

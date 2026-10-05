/**
 * Count-like metrics (dwellings, population, age bands, people, vehicles,
 * SGB2 BG/PERS, …) vs rates/shares. Shared by yearlySeries, Brain fact
 * signals, and heuristic evidence so interpolated Brain floats do not show
 * as „206.273,67“ on person counts.
 */

const RATE_TOKEN =
  /anteil|quote|rate|share|pct|percent|prozent|dichte|ratio|index|miete|preis|kaufkraft|einkommen|flaeche|wohnflaeche|jeew|je1000|_qm$|qm_|durchschnitt|median|quotient|mittelwert/i;

const RATE_UNIT = /(^|_)(eur|euro|usd|je|pro|per)(_|$)/i;

const COUNT_TOKEN =
  /wohnungen|dwellings|gebaeude|bauten|haushalte|einwohner|einwohnerzahl|bevoelkerung|personen|arbeitslose|bedarfsgemeinschaft|leistungsberechtigte|zuzuege|fortzuege|unfaelle|pendler|kinder|jugendliche|senioren|erwachsene|maenner|frauen|auslaender/i;

/** alter_40_59, alter 40 59, alter.40.59, bev_alter_25_39, altersgruppe_0_17, alter_60_plus */
const AGE_BAND_COUNT =
  /(^|_)alter(s(gruppe|band|klasse|jahr))?(_\d+)+(_(plus|u|und|und_aelter|jahre|jahr|bis|bis_unter))?$|(^|_)alter_\d+u$|(^|_)age(_\d+)+(_(plus|u))?$|(^|_)alt\d{2,3}b\d{2,3}$/;

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
  "kinder",
  "jugendliche",
  "senioren",
  "erwachsene",
]);

const KEY_LABELS: Record<string, string> = {
  raeume: "Räume",
};

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
  const parts = trimmed.split(".");
  if (parts.length < 2) return trimmed;
  const last = parts[parts.length - 1] ?? "";
  if (!last) return trimmed;
  // Dotted age bands (`alter.40.59`) — the last segment is a bound, not a nested field.
  if (/^\d+$/.test(last) || /^(plus|u|und|jahre|jahr)$/i.test(last)) return trimmed;
  return last;
}

export function compactMetricKey(key: string): string {
  return normalizeKey(key)
    .replace(/[\s.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function isRateLikeKey(key: string): boolean {
  const leaf = compactMetricKey(leafMetricKey(key));
  if (!leaf) return false;
  return RATE_TOKEN.test(leaf) || RATE_UNIT.test(leaf);
}

export function isCountMetricKey(key: string, metricId?: string): boolean {
  const leaf = compactMetricKey(leafMetricKey(key));
  if (isRateLikeKey(key) || (metricId && isRateLikeKey(metricId))) return false;
  if (leaf && (COUNT_EXACT.has(leaf) || COUNT_TOKEN.test(leaf) || AGE_BAND_COUNT.test(leaf))) {
    return true;
  }
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

/** Heuristic / evidence noun. Nested `wohnungen.raeume` is Räume, not Wohnungen. */
export function displayMetricLabel(key: string): string {
  const leaf = leafMetricKey(key);
  const compact = compactMetricKey(leaf);
  if (KEY_LABELS[compact]) return KEY_LABELS[compact];
  return leaf.replace(/[._]+/g, " ").trim();
}

/**
 * Period stamp in heuristic/evidence brackets (`2020|wohnungen: …`).
 * Nested leaves (`wohnungen.raeume`) and mapped siblings (`raeume`) use the
 * leaf label, not the parent/theme suffix from Brain `ref_period`.
 */
export function displayPeriodStamp(period: string, metricKey: string): string {
  const trimmed = period.trim();
  if (!trimmed) return "ohne Zeitraum";
  const sep = trimmed.lastIndexOf("|");
  if (sep <= 0 || sep === trimmed.length - 1) return trimmed;
  const datePart = trimmed.slice(0, sep).trim();
  const suffix = trimmed.slice(sep + 1).trim();
  if (!datePart || !suffix) return trimmed;
  if (!shouldRewritePeriodSuffix(metricKey, suffix)) return trimmed;
  return `${datePart}|${periodSuffixLabel(metricKey)}`;
}

function periodSuffixLabel(metricKey: string): string {
  const leaf = leafMetricKey(metricKey);
  const compact = compactMetricKey(leaf);
  if (KEY_LABELS[compact]) return KEY_LABELS[compact];
  return leaf;
}

function shouldRewritePeriodSuffix(metricKey: string, suffix: string): boolean {
  const leaf = leafMetricKey(metricKey);
  const compactLeaf = compactMetricKey(leaf);
  const compactSuffix = compactMetricKey(suffix);
  if (!compactLeaf || !compactSuffix || compactLeaf === compactSuffix) return false;

  const ancestors = metricKey
    .trim()
    .split(".")
    .slice(0, -1)
    .map((part) => compactMetricKey(part))
    .filter((part) => part.length > 0);
  if (leaf !== metricKey.trim() && ancestors.includes(compactSuffix)) return true;

  // Flat sibling under a Brain theme bag (`raeume` on `2020|wohnungen`).
  if (ancestors.length === 0 && KEY_LABELS[compactLeaf]) return true;
  return false;
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

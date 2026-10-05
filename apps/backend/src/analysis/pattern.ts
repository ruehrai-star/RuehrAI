import {
  AnalysisInput,
  AnalysisPattern,
  BrainFact,
  CriterionDirection,
  PatternCriterion,
  RevenueDirection,
} from "./types";
import { displayMetricLabel, formatMetricNumber, roundCountMetricValue } from "./count-metrics";

const SKIP_KEYS = new Set([
  "gemeinde_name",
  "geo_ags",
  "geo_ags5",
  "geo_land",
  "geo_land_name",
  "geo_key",
  "grain",
  "name",
  "title",
  "ref_period",
  "lon",
  "lat",
  "id",
]);

const MAX_CRITERIA = 5;
const DIRECTIONS = new Set<CriterionDirection>(["up", "down", "flat", "unknown"]);

const money = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function buildHeuristicPattern(
  input: AnalysisInput,
  facts: BrainFact[],
): AnalysisPattern {
  const criteria = heuristicCriteria(facts);
  return {
    source: "heuristic",
    summary: heuristicSummary(input, facts, criteria),
    revenueDirection: input.revenueDirection,
    criteria,
  };
}

export function parseLlmPattern(
  raw: string,
  facts: BrainFact[],
  revenueDirection: RevenueDirection,
): AnalysisPattern | null {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  if (summary.length < 8) return null;
  if (!Array.isArray(record.criteria)) return null;

  const criteria: PatternCriterion[] = [];
  for (const item of record.criteria) {
    const criterion = parseCriterion(item, facts);
    if (!criterion) continue;
    criteria.push(criterion);
    if (criteria.length >= MAX_CRITERIA) break;
  }
  if (criteria.length === 0) return null;

  return {
    source: "llm",
    summary: summary.slice(0, 2000),
    revenueDirection,
    criteria,
  };
}

export function isGroundedKey(key: string, facts: BrainFact[]): boolean {
  const needle = key.trim().toLowerCase();
  if (!needle) return false;
  return facts.some((fact) => {
    if (fact.signals.some((signal) => signal.key.toLowerCase() === needle)) return true;
    return `${fact.title}\n${fact.excerpt}`.toLowerCase().includes(needle);
  });
}

function heuristicCriteria(facts: BrainFact[]): PatternCriterion[] {
  const grouped = new Map<string, Map<string, number[]>>();
  const counts = new Map<string, number>();

  for (const fact of facts) {
    const seen = new Set<string>();
    for (const signal of fact.signals) {
      if (SKIP_KEYS.has(signal.key) || signal.key === "source_theme") continue;
      const numeric = asNumber(signal.value);
      if (numeric === null) continue;
      const value = roundCountMetricValue(signal.key, numeric);
      if (!seen.has(signal.key)) {
        counts.set(signal.key, (counts.get(signal.key) ?? 0) + 1);
        seen.add(signal.key);
      }
      const periods = grouped.get(signal.key) ?? new Map<string, number[]>();
      const period = fact.refPeriod ?? "";
      const values = periods.get(period) ?? [];
      values.push(value);
      periods.set(period, values);
      grouped.set(signal.key, periods);
    }
  }

  const keys = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_CRITERIA)
    .map(([key]) => key);

  return keys.map((key) => {
    const direction = directionAcrossPeriods(grouped.get(key) ?? new Map());
    return {
      key,
      label: labelFor(key),
      direction,
      evidence: evidenceFor(key, grouped.get(key) ?? new Map(), direction),
    };
  });
}

function directionAcrossPeriods(periods: Map<string, number[]>): CriterionDirection {
  const ordered = [...periods.entries()]
    .filter(([period, values]) => period !== "" && values.length > 0)
    .sort((left, right) => left[0].localeCompare(right[0]));
  if (ordered.length < 2) return "unknown";
  const first = mean(ordered[0][1]);
  const last = mean(ordered[ordered.length - 1][1]);
  const scale = Math.max(Math.abs(first), 1);
  if (Math.abs(last - first) / scale < 0.01) return "flat";
  return last > first ? "up" : "down";
}

function evidenceFor(
  key: string,
  periods: Map<string, number[]>,
  direction: CriterionDirection,
): string {
  const ordered = [...periods.entries()]
    .filter(([, values]) => values.length > 0)
    .sort((left, right) => left[0].localeCompare(right[0]));
  if (ordered.length === 0) {
    return `${labelFor(key)} kommt in den Brain-Fakten vor, ohne Zahlenreihe.`;
  }
  const rendered = ordered
    .slice(0, 4)
    .map(([period, values]) => {
      const stamp = period || "ohne Zeitraum";
      return `${stamp}: ${formatMetricNumber(key, mean(values))}`;
    })
    .join("; ");
  if (direction === "unknown") {
    return `${labelFor(key)} liegt in den Brain-Fakten nur zu einem Stichtag vor (${rendered}). Eine Monat-zu-Monat-Richtung ist daraus nicht ableitbar.`;
  }
  const word = direction === "up" ? "steigt" : direction === "down" ? "fällt" : "bleibt nahezu gleich";
  return `${labelFor(key)} ${word} zwischen den vorliegenden Zeiträumen (${rendered}).`;
}

function heuristicSummary(
  input: AnalysisInput,
  facts: BrainFact[],
  criteria: PatternCriterion[],
): string {
  const changeSum = input.stores.reduce(
    (total, store) => total + store.changes.reduce((sum, change) => sum + change.changeEur, 0),
    0,
  );
  const trend =
    input.revenueDirection === "up"
      ? "steigend"
      : input.revenueDirection === "down"
        ? "fallend"
        : "unverändert";
  const revenue = `Der Filialumsatz ist ${trend} (Summe der Veränderungen zwischen aufeinanderfolgenden Monaten: ${money.format(changeSum)} EUR).`;
  if (facts.length === 0) {
    return `${revenue} In der Zielregion wurden keine Brain-Fakten gefunden. Das Muster beschreibt nur die Umsatzrichtung. Quelle: Heuristik, ohne Sprachmodell.`;
  }
  if (criteria.length === 0) {
    return `${revenue} Die ${facts.length} Brain-Fakten nennen keine vergleichbaren Kennzahlen. Quelle: Heuristik, ohne Sprachmodell.`;
  }
  const listed = criteria
    .map((criterion) => `${criterion.label} (${directionWord(criterion.direction)})`)
    .join(", ");
  return `${revenue} Aus den Brain-Fakten: ${listed}. Quelle: Heuristik, ohne Sprachmodell.`;
}

function parseCriterion(item: unknown, facts: BrainFact[]): PatternCriterion | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const key = typeof record.key === "string" ? record.key.trim() : "";
  if (!key || key.length > 120 || !isGroundedKey(key, facts)) return null;
  const direction = record.direction;
  if (typeof direction !== "string" || !DIRECTIONS.has(direction as CriterionDirection)) {
    return null;
  }
  const evidence = typeof record.evidence === "string" ? record.evidence.trim() : "";
  if (evidence.length < 8 || !evidenceTouchesFacts(evidence, facts)) return null;
  const label =
    typeof record.label === "string" && record.label.trim().length > 0
      ? record.label.trim().slice(0, 160)
      : labelFor(key);
  return {
    key,
    label,
    direction: direction as CriterionDirection,
    evidence: evidence.slice(0, 500),
  };
}

function evidenceTouchesFacts(evidence: string, facts: BrainFact[]): boolean {
  const haystack = facts
    .map((fact) =>
      [
        fact.title,
        fact.excerpt,
        fact.refPeriod ?? "",
        fact.geoKey,
        ...fact.signals.flatMap((signal) => [signal.key, signal.value]),
      ].join(" "),
    )
    .join(" ")
    .toLowerCase();
  const tokens = evidence.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  return tokens.some((token) => token.length >= 4 && haystack.includes(token));
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  }
}

function asNumber(value: string): number | null {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function labelFor(key: string): string {
  return displayMetricLabel(key);
}

function directionWord(direction: CriterionDirection): string {
  if (direction === "up") return "steigt";
  if (direction === "down") return "fällt";
  if (direction === "flat") return "unverändert";
  return "ohne erkennbare Richtung";
}

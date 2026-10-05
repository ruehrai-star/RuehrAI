import {
  displayMetricLabel,
  displayPeriodStamp,
  formatMetricNumber,
  roundCountMetricValue,
} from "./count-metrics";
import {
  FactGeoMatch,
  classifyFactGeo,
  factsMatchingTargetRegion,
  higherAdminNoun,
  isDestatisAgs5Fact,
  isDestatisBevInsgesamt,
  isPopulationMetricKey,
  tierRank,
} from "./pattern-geo";
import {
  AnalysisInput,
  AnalysisPattern,
  AnalysisRegion,
  BrainFact,
  CriterionDirection,
  PatternCriterion,
  RevenueDirection,
  analysisRegions,
} from "./types";

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
  const localFacts = factsMatchingTargetRegion(input, facts);
  const criteria = heuristicCriteria(input, localFacts);
  return {
    source: "heuristic",
    summary: heuristicSummary(input, localFacts, criteria),
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

interface Observation {
  key: string;
  value: number;
  period: string;
  geoKey: string;
  match: FactGeoMatch;
  sourceTheme: string | null;
  destatisAgs5: boolean;
}

interface MetricSeries {
  key: string;
  periods: Map<string, number>;
  match: FactGeoMatch;
  factCount: number;
}

function heuristicCriteria(input: AnalysisInput, facts: BrainFact[]): PatternCriterion[] {
  const regions = analysisRegions(input);
  const observations = collectObservations(facts, regions);
  const series = seriesByKey(observations);
  const ranked = [...series.values()]
    .sort((left, right) => right.factCount - left.factCount || left.key.localeCompare(right.key))
    .slice(0, MAX_CRITERIA);

  return ranked.map((item) => {
    const direction = directionAcrossPeriods(item.periods);
    const label = labeledMetric(item.key, item.match);
    return {
      key: item.key,
      label,
      direction,
      evidence: evidenceFor(item.key, label, item.periods, direction),
    };
  });
}

function collectObservations(facts: BrainFact[], regions: AnalysisRegion[]): Observation[] {
  const observations: Observation[] = [];
  for (const fact of facts) {
    const match = classifyFactGeo(fact, regions);
    if (!match) continue;
    const sourceTheme = themeOf(fact);
    const destatisAgs5 = isDestatisAgs5Fact(fact);
    for (const signal of fact.signals) {
      if (SKIP_KEYS.has(signal.key) || signal.key === "source_theme") continue;
      const numeric = asNumber(signal.value);
      if (numeric === null) continue;
      const value = roundCountMetricValue(signal.key, numeric);
      observations.push({
        key: signal.key,
        value,
        period: fact.refPeriod ?? "",
        geoKey: fact.geoKey,
        match,
        sourceTheme,
        destatisAgs5,
      });
    }
  }
  return observations;
}

function seriesByKey(observations: Observation[]): Map<string, MetricSeries> {
  const byKey = new Map<string, Observation[]>();
  for (const item of observations) {
    const list = byKey.get(item.key) ?? [];
    list.push(item);
    byKey.set(item.key, list);
  }

  if (hasPreferredDestatisBev(observations)) {
    for (const key of [...byKey.keys()]) {
      if (key !== "bev_insgesamt" && isPopulationMetricKey(key)) byKey.delete(key);
    }
  }

  const series = new Map<string, MetricSeries>();
  for (const [key, items] of byKey) {
    const chosen = pickSameGeoObservations(key, items);
    if (!chosen || chosen.items.length === 0) continue;
    series.set(key, {
      key,
      periods: valuesByPeriod(chosen.items),
      match: chosen.items[0]!.match,
      factCount: new Set(chosen.items.map((item) => `${item.geoKey}|${item.period}`)).size,
    });
  }
  return series;
}

function hasPreferredDestatisBev(observations: Observation[]): boolean {
  return observations.some((item) => isDestatisBevInsgesamt(item.key, item.sourceTheme));
}

function pickSameGeoObservations(
  key: string,
  items: Observation[],
): { items: Observation[] } | null {
  if (items.length === 0) return null;
  let pool = items;
  if (isPopulationMetricKey(key)) {
    const destatisAgs5 = items.filter(
      (item) => isDestatisBevInsgesamt(item.key, item.sourceTheme) && item.destatisAgs5,
    );
    const destatis = items.filter((item) => isDestatisBevInsgesamt(item.key, item.sourceTheme));
    if (destatisAgs5.length > 0) pool = destatisAgs5;
    else if (destatis.length > 0) pool = destatis;
  }

  const finest = Math.min(...pool.map((item) => tierRank(item.match.tier)));
  const atFinest = pool.filter((item) => tierRank(item.match.tier) === finest);
  const geoKey = pickGeoKey(atFinest);
  return { items: atFinest.filter((item) => item.geoKey === geoKey) };
}

function pickGeoKey(items: Observation[]): string {
  const destatis = items.find((item) => isDestatisBevInsgesamt(item.key, item.sourceTheme));
  if (destatis) return destatis.geoKey;
  return [...new Set(items.map((item) => item.geoKey))].sort((left, right) => left.localeCompare(right))[0] ?? "";
}

function valuesByPeriod(items: Observation[]): Map<string, number> {
  const sorted = [...items].sort((left, right) => {
    const destatis =
      Number(isDestatisBevInsgesamt(right.key, right.sourceTheme)) -
      Number(isDestatisBevInsgesamt(left.key, left.sourceTheme));
    if (destatis !== 0) return destatis;
    return left.period.localeCompare(right.period);
  });
  const periods = new Map<string, number>();
  for (const item of sorted) {
    if (periods.has(item.period)) continue;
    periods.set(item.period, item.value);
  }
  return periods;
}

function directionAcrossPeriods(periods: Map<string, number>): CriterionDirection {
  const ordered = [...periods.entries()]
    .filter(([period]) => period !== "")
    .sort((left, right) => left[0].localeCompare(right[0]));
  if (ordered.length < 2) return "unknown";
  const first = ordered[0]![1];
  const last = ordered[ordered.length - 1]![1];
  const scale = Math.max(Math.abs(first), 1);
  if (Math.abs(last - first) / scale < 0.01) return "flat";
  return last > first ? "up" : "down";
}

function evidenceFor(
  key: string,
  label: string,
  periods: Map<string, number>,
  direction: CriterionDirection,
): string {
  const ordered = [...periods.entries()].sort((left, right) => left[0].localeCompare(right[0]));
  if (ordered.length === 0) {
    return `${label} liegt nicht vor.`;
  }
  const rendered = ordered
    .slice(0, 4)
    .map(([period, value]) => {
      const stamp = displayPeriodStamp(period, key);
      return `${stamp}: ${formatMetricNumber(key, value)}`;
    })
    .join("; ");
  if (direction === "unknown") {
    return `${label} liegt in den Brain-Fakten nur zu einem Stichtag vor (${rendered}). Eine Monat-zu-Monat-Richtung ist daraus nicht ableitbar.`;
  }
  const word = direction === "up" ? "steigt" : direction === "down" ? "fällt" : "bleibt nahezu gleich";
  return `${label} ${word} zwischen den vorliegenden Zeiträumen (${rendered}).`;
}

function labeledMetric(key: string, match: FactGeoMatch): string {
  const base = labelFor(key);
  const noun = higherAdminNoun(match);
  return noun ? `${base} (${noun})` : base;
}

function themeOf(fact: BrainFact): string | null {
  const signal = fact.signals.find((item) => item.key === "source_theme");
  const value = signal?.value?.trim();
  return value ? value : null;
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

function labelFor(key: string): string {
  return displayMetricLabel(key);
}

function directionWord(direction: CriterionDirection): string {
  if (direction === "up") return "steigt";
  if (direction === "down") return "fällt";
  if (direction === "flat") return "unverändert";
  return "ohne erkennbare Richtung";
}

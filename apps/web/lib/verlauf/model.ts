import type {
  AnalysisPattern,
  MonthlyRevenuePoint,
  Recommendation,
  RecommendationSet,
  RecommendationWindow,
  TargetRegion,
} from "@ruehrai/api-contracts";
import { criterionDirectionLabel } from "../analysis/model.ts";
import { grainLabel } from "../format.ts";
import { formatAddress, RECOMMENDATION_COPY } from "../recommendations/model.ts";

/**
 * OpenAPI `AnalysisPattern` has no three-year Kleinraum series
 * (`2023` / `2024` / `2025` means, monthly points, dataset name).
 * The Verlauf hero uses `summary`, `criteria`, `rationale`, and `title`.
 */
export const MISSING_CONTRACT_FIELD = "AnalysisPattern.yearlySeries";

/** After Standorte the product opens Verlauf. Vorschlag 1 (Karte zuerst) does not apply. */
export const POST_STANDORTE_HREF = "/verlauf" as const;

export const SELECTABLE_AREA_LEVELS = ["Stadtbezirk", "Stadtteil", "Ortsteil", "PLZ"] as const;

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mär",
  "Apr",
  "Mai",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Dez",
] as const;

export const VERLAUF_COPY = {
  title: "Verlauf",
  kicker: "Verlauf",
  heroHeading: "Abgeleitetes Muster",
  nextHeading: "Weiterentwicklung",
  nextLead: "Als Nächstes",
  top3: RECOMMENDATION_COPY.subtitle,
  proof: "Lage",
  revenueOptional: "Monatsumsatz der bestehenden Standorte (optional)",
  levels: "Stadtbezirk, Stadtteil, Ortsteil und PLZ bleiben wählbar.",
  gemeindeHint: "Gemeinde gilt nur für eine Gemeinde. Ohne Teilgebiet ist das kein Fehler.",
  toStandorte: "Zu den Standorten",
  toAnalysis: "Zur Musteranalyse",
  compute: RECOMMENDATION_COPY.compute,
  running: RECOMMENDATION_COPY.running,
  noneYet: RECOMMENDATION_COPY.noneYet,
  empty: RECOMMENDATION_COPY.empty,
  thin: RECOMMENDATION_COPY.thin,
  missingPattern: "Es liegt noch kein Muster vor. Bitte zuerst eine Analyse starten.",
  signedOut: "Der Verlauf steht nach der Anmeldung zur Verfügung.",
} as const;

export interface VerlaufCriterion {
  key: string;
  label: string;
  direction: string;
  evidence: string;
}

export interface VerlaufTop3 {
  id: string;
  rank: number;
  address: string;
  rationale: string;
}

export interface VerlaufHero {
  heading: typeof VERLAUF_COPY.heroHeading;
  change: string;
  criteria: VerlaufCriterion[];
  months: string[];
  nextHeading: typeof VERLAUF_COPY.nextHeading;
  nextSentence: string | null;
  nextAddress: string | null;
  top3: VerlaufTop3[];
  hasYearlySeries: false;
  missingContractField: typeof MISSING_CONTRACT_FIELD;
  engine: "pattern";
}

export interface VerlaufRegionView {
  label: string | null;
  badge: string | null;
  error: string | null;
}

export function isPostStandorteMap(): boolean {
  return POST_STANDORTE_HREF === "/";
}

/** A Gemeinde without Ortsteil / Stadtteil is a valid Zielregion. */
export function municipalityNeedsSubarea(): boolean {
  return false;
}

export function regionView(region: TargetRegion | null): VerlaufRegionView {
  if (!region) return { label: null, badge: null, error: null };
  return {
    label: region.label,
    badge: region.grain ? grainLabel(region.grain, region.ags || region.geoKey) : null,
    error: null,
  };
}

export function monthRow(window: RecommendationWindow | null | undefined): string[] {
  if (!window) return [];
  const start = parseYearMonth(window.from);
  const end = parseYearMonth(window.to);
  if (!start || !end) return [];
  const rows: string[] = [];
  let { year, month } = start;
  while (year < end.year || (year === end.year && month <= end.month)) {
    const name = MONTHS_SHORT[month - 1];
    if (name) rows.push(name);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    if (rows.length > 36) break;
  }
  return rows;
}

/**
 * Hero is the Kleinraum change and the next step. Store revenue is never the
 * engine. No yearly means and no dataset name are invented.
 */
export function buildVerlaufHero(input: {
  pattern: AnalysisPattern | null;
  recommendations: RecommendationSet | null;
  revenue?: MonthlyRevenuePoint[];
}): VerlaufHero | null {
  if (!input.pattern) return null;
  const first = input.recommendations?.items[0] ?? null;
  return {
    heading: VERLAUF_COPY.heroHeading,
    change: input.pattern.summary.trim(),
    criteria: input.pattern.criteria.map((criterion) => ({
      key: criterion.key,
      label: criterion.label,
      direction: criterionDirectionLabel(criterion.direction),
      evidence: criterion.evidence,
    })),
    months: monthRow(input.recommendations?.window),
    nextHeading: VERLAUF_COPY.nextHeading,
    nextSentence: first?.rationale.trim() || null,
    nextAddress: first ? streetAddress(first) : null,
    top3: (input.recommendations?.items ?? []).map((item) => ({
      id: item.id,
      rank: item.rank,
      address: streetAddress(item),
      rationale: item.rationale,
    })),
    hasYearlySeries: false,
    missingContractField: MISSING_CONTRACT_FIELD,
    engine: "pattern",
  };
}

export function streetAddress(item: Recommendation): string {
  return formatAddress(item);
}

export function optionalRevenueCount(points: MonthlyRevenuePoint[] | null | undefined): number {
  if (!points) return 0;
  return points.filter((point) => point.revenueEur != null).length;
}

function parseYearMonth(value: string): { year: number; month: number } | null {
  const match = /^([0-9]{4})-([0-9]{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

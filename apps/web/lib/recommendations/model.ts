import type { AnalysisPattern, Recommendation, RecommendationSet, RecommendationWindow } from "@ruehrai/api-contracts";
import { criterionDirectionLabel, patternSourceLabel } from "../analysis/model.ts";
import { catalogBadge, catalogParentName } from "../format.ts";

/** UX-Gate labels for the Empfehlungen page. */
export const RECOMMENDATION_COPY = {
  title: "Empfehlungen",
  subtitle: "Top 3 in Ihrer Zielregion",
  patternHeading: "Abgeleitetes Muster",
  shortCriteriaHeading: "Kurzkriterien",
  address: "Adresse",
  rationale: "Begründung",
  details: "Details",
  empty: "Keine passenden Standorte in der Zielregion.",
  emptyPlural: "Keine passenden Standorte in den Zielregionen.",
  subtitlePlural: "Top 3 in Ihren Zielregionen",
  thin: "Die Zielregion ist dünn besetzt.",
  compute: "Empfehlungen berechnen",
  running: "Empfehlungen werden ermittelt …",
  toAnalysis: "Zur Musteranalyse",
  noneYet: "Es liegen noch keine Empfehlungen vor. Bitte zuerst Empfehlungen berechnen.",
} as const;

const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
] as const;

export function recommendationSubtitle(regionCount: number): string | null {
  if (regionCount <= 0) return null;
  if (regionCount === 1) return RECOMMENDATION_COPY.subtitle;
  return RECOMMENDATION_COPY.subtitlePlural;
}

export function recommendationEmptyCopy(regionCount: number): string | null {
  if (regionCount <= 0) return null;
  if (regionCount === 1) return RECOMMENDATION_COPY.empty;
  return RECOMMENDATION_COPY.emptyPlural;
}

export function rankLabel(rank: number): string {
  return `Rang ${rank}`;
}

export function formatAddress(item: Recommendation): string {
  const title = item.title.trim();
  const name = item.location.name?.trim() ?? "";
  if (name && name !== title) return `${title}, ${name}`;
  return title;
}

export function formatLocationMeta(item: Recommendation): string {
  const badge = catalogBadge(item.location);
  const parent = catalogParentName(item.location);
  const key = item.location.geoKey;
  return parent ? `${badge} ${parent} ${key}` : `${badge} ${key}`;
}

export function formatScore(score: number): string {
  const percent = new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 0 }).format(score);
  return `Passung ${percent}`;
}

export function formatWindow(window: RecommendationWindow): string {
  return `${formatMonth(window.from)} – ${formatMonth(window.to)}`;
}

export function shortCriteria(pattern: AnalysisPattern): string[] {
  return pattern.criteria.map(
    (criterion) => `${criterion.label} · ${criterionDirectionLabel(criterion.direction)}`,
  );
}

export function recommendationSourceLabel(source: Recommendation["source"]): string {
  return patternSourceLabel(source);
}

/**
 * Fewer than three matches keep the Backend `reason`. Zero matches still show
 * the UX-Gate empty sentence when that sentence is not already inside `reason`.
 */
export function recommendationStatus(set: RecommendationSet): { empty: boolean; thin: boolean; reason: string | null } {
  const empty = set.items.length === 0;
  const thin = set.items.length > 0 && set.items.length < 3;
  const reason = set.reason?.trim() ? set.reason.trim() : null;
  if (
    empty &&
    reason &&
    (reason.includes(RECOMMENDATION_COPY.empty) || reason.includes(RECOMMENDATION_COPY.emptyPlural))
  ) {
    return { empty: false, thin: false, reason };
  }
  return { empty, thin, reason };
}

function formatMonth(stamp: string): string {
  const [year, month] = stamp.split("-");
  const name = MONTHS[Number(month) - 1];
  return name ? `${name} ${year}` : stamp;
}

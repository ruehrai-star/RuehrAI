import { AnalysisPattern } from "../analysis/types";
import { RecommendationEvidence, RecommendationWindow, ScoredLocation } from "./types";

const SYSTEM_PROMPT = [
  "Du schreibst die Begründung je Standortempfehlung von RuehrAI.",
  "Antworte nur mit einem JSON-Objekt, ohne Markdown:",
  '{"items":[{"id":"...","rationale":"..."}]}',
  "Regeln:",
  "- Deutsch, ein bis drei Sätze je Eintrag.",
  "- Erfinde keine Kennzahlen, Orte oder Zeiträume.",
  "- Jede Zahl im Text muss in den gelieferten criteriaEvidence, im Titel oder im Fenster vorkommen.",
  "- Erkläre nur Kriterien, die in criteriaEvidence stehen, und dass ihre Richtung zum Muster passt.",
  "- id muss eine der gelieferten ids sein.",
  "- Höchstens die gelieferten Einträge, keine zusätzlichen Standorte.",
].join("\n");

export function rationaleSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function rationaleUserPayload(
  pattern: AnalysisPattern,
  window: RecommendationWindow,
  items: ScoredLocation[],
): string {
  return JSON.stringify({
    window,
    pattern: {
      summary: pattern.summary,
      revenueDirection: pattern.revenueDirection,
      criteria: pattern.criteria.map((criterion) => ({
        key: criterion.key,
        label: criterion.label,
        direction: criterion.direction,
      })),
    },
    items: items.map((item) => ({
      id: item.id,
      title: item.title,
      geoKey: item.location.geoKey,
      grain: item.location.grain,
      score: item.score,
      criteriaEvidence: item.criteriaEvidence,
    })),
  });
}

export function buildHeuristicRationale(item: ScoredLocation): string {
  const parts = item.criteriaEvidence.map(
    (entry) => `${entry.label} (${entry.evidence})`,
  );
  const body = parts.length > 0 ? parts.join(" ") : "ohne einzelne Kennzahl";
  return `Am Standort ${item.title} (${item.location.geoKey}) passt das Muster in den letzten sechs Monaten: ${body} Quelle: Heuristik, ohne Sprachmodell.`;
}

/**
 * Keep a model rationale only when it names the location and every number
 * already appears in the evidence supplied for that location.
 */
export function acceptRationales(
  raw: string,
  items: ScoredLocation[],
  window: RecommendationWindow,
): Map<string, string> {
  const parsed = extractJson(raw);
  const accepted = new Map<string, string>();
  if (!parsed || typeof parsed !== "object") return accepted;
  const list = (parsed as { items?: unknown }).items;
  if (!Array.isArray(list)) return accepted;

  const byId = new Map(items.map((item) => [item.id, item]));
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { id?: unknown; rationale?: unknown };
    if (typeof record.id !== "string" || typeof record.rationale !== "string") continue;
    const item = byId.get(record.id);
    if (!item) continue;
    const rationale = record.rationale.trim().slice(0, 2000);
    if (!rationaleIsGrounded(rationale, item, window)) continue;
    accepted.set(item.id, rationale);
  }
  return accepted;
}

export function rationaleIsGrounded(
  rationale: string,
  item: ScoredLocation,
  window: RecommendationWindow,
): boolean {
  if (rationale.length < 20) return false;
  if (/heuristik/i.test(rationale)) return false;
  const haystack = rationale.toLowerCase();
  const title = item.title.toLowerCase();
  const geoKey = item.location.geoKey.toLowerCase();
  if (!haystack.includes(title) && !haystack.includes(geoKey)) return false;
  if (!mentionsEvidence(haystack, item.criteriaEvidence)) return false;
  const corpus = corpusFor(item, window);
  return numbersIn(rationale).every((token) => numberIsGrounded(token, corpus));
}

function mentionsEvidence(haystack: string, evidence: RecommendationEvidence[]): boolean {
  return evidence.some((entry) => {
    const label = entry.label.toLowerCase();
    const key = entry.key.toLowerCase();
    return (label.length >= 3 && haystack.includes(label)) || haystack.includes(key);
  });
}

function corpusFor(item: ScoredLocation, window: RecommendationWindow): string {
  return [
    item.title,
    item.location.geoKey,
    item.location.grain,
    item.location.name ?? "",
    window.from,
    window.to,
    "6",
    ...item.criteriaEvidence.flatMap((entry) => [
      entry.key,
      entry.label,
      entry.evidence,
      entry.direction,
      entry.patternDirection,
    ]),
  ]
    .join("\n")
    .toLowerCase();
}

function numbersIn(text: string): string[] {
  return text.match(/\d+(?:[.,]\d+)*/g) ?? [];
}

function numberIsGrounded(token: string, corpus: string): boolean {
  if (corpus.includes(token.toLowerCase())) return true;
  const normalized = token.replace(/\./g, "").replace(",", ".");
  if (corpus.includes(normalized)) return true;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) return false;
  const formatted = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(numeric);
  return corpus.includes(formatted.toLowerCase());
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

import type {
  AnalysisBrain,
  AnalysisInput,
  AnalysisPattern,
  CriterionDirection,
  RevenueDirection,
} from "@ruehrai/api-contracts";

/** UX-Gate KAN-33. These strings are the product labels, not paraphrases. */
export const ANALYSIS_COPY = {
  title: "Musteranalyse",
  help: "Aus Ihren Standorten und Umsätzen leiten wir ein Kriterien-Muster ab.",
  summary: "Zielregion · Filialen · Monate Umsatz",
  start: "Analyse starten",
  back: "Zurück zu Standorten",
  empty: "Keine Analyse ausgewählt.",
  running: "Analyse läuft …",
  failed: "Analyse fehlgeschlagen. Bitte erneut versuchen.",
  patternHeading: "Abgeleitetes Muster",
  briefHeading: "Kurzfassung",
  brainHeading: "Brain-Suche",
  criteriaHeading: "Kriterien",
} as const;

export function revenueMonthCount(input: AnalysisInput): number {
  return input.stores.reduce(
    (total, store) => total + store.points.filter((point) => point.revenueEur !== null).length,
    0,
  );
}

/** Filled summary. The caption stays the exact UX-Gate line. */
export function formatAnalysisSummary(input: AnalysisInput): string {
  return `Zielregion: ${input.region.label} · Filialen: ${input.stores.length} · Monate Umsatz: ${revenueMonthCount(input)}`;
}

export function revenueDirectionLabel(direction: RevenueDirection): string {
  if (direction === "up") return "steigend";
  if (direction === "down") return "fallend";
  return "unverändert";
}

export function criterionDirectionLabel(direction: CriterionDirection): string {
  if (direction === "up") return "steigend";
  if (direction === "down") return "fallend";
  if (direction === "flat") return "unverändert";
  return "ohne erkennbare Richtung";
}

export function patternSourceLabel(source: AnalysisPattern["source"]): string {
  return source === "llm" ? "Sprachmodell" : "Heuristik";
}

export interface BrainStatusText {
  mode: string;
  detail: string | null;
}

/**
 * German status for `AnalysisBrain`. OpenAPI 0.3.0 has no running/failed run
 * status — only `completed`, plus `mode` `vector` | `sql` and an optional reason.
 */
export function brainStatusText(brain: AnalysisBrain): BrainStatusText {
  const facts = brain.factCount === 1 ? "1 Fakt" : `${brain.factCount} Fakten`;
  if (brain.mode === "vector") {
    return { mode: `Vektorsuche · ${facts}`, detail: null };
  }
  return {
    mode: `Filter ohne Vektor · ${facts}`,
    detail: reasonLabel(brain.vectorUnavailableReason),
  };
}

function reasonLabel(reason: AnalysisBrain["vectorUnavailableReason"]): string | null {
  switch (reason) {
    case "embeddings_disabled":
      return "Einbettungen sind deaktiviert.";
    case "embeddings_unconfigured":
      return "Einbettungen sind nicht konfiguriert.";
    case "embeddings_unreachable":
      return "Einbettungen sind nicht erreichbar.";
    case "embeddings_rejected":
      return "Einbettungen wurden abgelehnt.";
    case "vector_query_failed":
      return "Die Vektorsuche ist fehlgeschlagen.";
    case "no_embeddings_in_region":
      return "In der Zielregion liegen keine Einbettungen vor.";
    case "features_unavailable":
      return "Merkmale sind nicht verfügbar.";
    case null:
    case undefined:
      return null;
    default: {
      const unknown: never = reason;
      return unknown;
    }
  }
}

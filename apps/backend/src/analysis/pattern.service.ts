import { Injectable } from "@nestjs/common";
import { OmlxClient } from "./omlx.client";
import { buildHeuristicPattern, parseLlmPattern } from "./pattern";
import { AnalysisInput, AnalysisPattern, BrainFact } from "./types";

const SYSTEM_PROMPT = [
  "Du bist die Musteranalyse von RuehrAI.",
  "Du erhältst die Umsatzänderungen der Filialen und kleinräumige Brain-Fakten.",
  "Antworte nur mit einem JSON-Objekt, ohne Markdown:",
  '{"summary":"...","criteria":[{"key":"...","label":"...","direction":"up|down|flat|unknown","evidence":"..."}]}',
  "Regeln:",
  "- Erfinde keine Kennzahlen, Orte oder Zeiträume.",
  "- criteria.key muss exakt einem signals.key entsprechen oder wörtlich in title oder excerpt vorkommen.",
  "- evidence bezieht sich nur auf die gelieferten Fakten und die Umsatzreihe.",
  "- direction beschreibt das Kriterium. unknown, wenn die Fakten keine zeitliche Entwicklung zeigen.",
  "- Wenn keine Korrelation belegbar ist, wenige Kriterien mit direction unknown und das in summary sagen.",
  "- Höchstens 5 Kriterien.",
].join("\n");

@Injectable()
export class PatternService {
  constructor(private readonly omlx: OmlxClient) {}

  /**
   * Derives a pattern grounded in the retrieved Brain facts.
   * The revenue direction is computed from the stored months, not from the model.
   * If oMLX chat is unset or fails, the result is marked source "heuristic".
   */
  async derive(input: AnalysisInput, facts: BrainFact[]): Promise<AnalysisPattern> {
    const heuristic = buildHeuristicPattern(input, facts);
    if (facts.length === 0 || !this.omlx.llmEnabled()) return heuristic;

    const payload = JSON.stringify({
      revenueDirection: input.revenueDirection,
      region: {
        label: input.region.label,
        grain: input.region.grain,
        geoKey: input.region.geoKey,
        ags: input.region.ags,
        plz: input.region.plz,
      },
      stores: input.stores.map((store) => ({
        id: store.id,
        city: store.city,
        postalCode: store.postalCode,
        changes: store.changes,
      })),
      facts,
    });
    const completed = await this.omlx.complete(SYSTEM_PROMPT, payload);
    if (!completed.ok) return heuristic;
    return parseLlmPattern(completed.content, facts, input.revenueDirection) ?? heuristic;
  }
}

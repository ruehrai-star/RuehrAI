import { Injectable } from "@nestjs/common";
import { OmlxClient } from "./omlx.client";
import { buildHeuristicPattern, parseLlmPattern } from "./pattern";
import { factsMatchingStoreSurroundings } from "./store-surroundings";
import { StoreSurroundingsService } from "./store-surroundings.service";
import { AnalysisInput, AnalysisPattern, BrainFact } from "./types";
import { asOfFrom } from "./yearly-series";
import { YearlySeriesService } from "./yearly-series.service";

const SYSTEM_PROMPT = [
  "Du bist die Musteranalyse von RuehrAI.",
  "Du erhältst die Umsatzänderungen der Filialen und Brain-Kennzahlen aus der Umgebung der Bestandstandorte.",
  "Die Zielregion ist kein Muster-Input — nur die Filialumgebung.",
  "Antworte nur mit einem JSON-Objekt, ohne Markdown:",
  '{"summary":"...","criteria":[{"key":"...","label":"...","direction":"up|down|flat|unknown","evidence":"..."}]}',
  "Regeln:",
  "- Erfinde keine Kennzahlen, Orte oder Zeiträume.",
  "- criteria.key muss exakt einem signals.key oder einer yearlySeries.metricId entsprechen.",
  "- evidence bezieht sich nur auf die gelieferten Fakten, Reihen und die Umsatzreihe.",
  "- direction beschreibt das Kriterium. unknown, wenn nur ein Stichtag vorliegt.",
  "- Stichtag nicht als Monat-zu-Monat-Richtung beschreiben.",
  "- Fehlende Werte als 'liegt nicht vor' benennen, niemals 0 erfinden.",
  "- Wenn keine Korrelation belegbar ist, wenige Kriterien mit direction unknown und das in summary sagen.",
  "- Höchstens 5 Kriterien.",
].join("\n");

@Injectable()
export class PatternService {
  constructor(
    private readonly omlx: OmlxClient,
    private readonly surroundings: StoreSurroundingsService,
    private readonly yearlySeries: YearlySeriesService,
  ) {}

  /**
   * Derives a pattern from Bestandstandort surroundings, not the Zielregion.
   * Revenue direction is computed from stored months, not from the model.
   */
  async derive(input: AnalysisInput, facts: BrainFact[]): Promise<AnalysisPattern> {
    const surroundings = await this.surroundings.resolve(input.stores);
    const storeSeries = await this.yearlySeries.build(surroundings.regions, asOfFrom(input.capturedAt));
    const storeFacts = factsMatchingStoreSurroundings(input, facts, surroundings.keys);
    const heuristic = buildHeuristicPattern(input, storeFacts, storeSeries);
    if ((storeFacts.length === 0 && storeSeries.length === 0) || !this.omlx.llmEnabled()) {
      return heuristic;
    }

    const payload = JSON.stringify({
      revenueDirection: input.revenueDirection,
      stores: input.stores.map((store) => ({
        id: store.id,
        city: store.city,
        postalCode: store.postalCode,
        changes: store.changes,
      })),
      surroundings: surroundings.regions,
      yearlySeries: storeSeries.map((item) => ({
        metricId: item.metricId,
        sourceLevel: item.sourceLevel,
        sourceGeoKey: item.sourceGeoKey,
        coverage: item.coverage,
        points: item.points,
      })),
      facts: storeFacts,
    });
    const completed = await this.omlx.complete(SYSTEM_PROMPT, payload);
    if (!completed.ok) return heuristic;
    return parseLlmPattern(completed.content, storeFacts, input.revenueDirection, storeSeries) ?? heuristic;
  }
}

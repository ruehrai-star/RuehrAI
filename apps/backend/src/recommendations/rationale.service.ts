import { Injectable } from "@nestjs/common";
import { OmlxClient } from "../analysis/omlx.client";
import { AnalysisPattern } from "../analysis/types";
import {
  acceptRationales,
  buildHeuristicRationale,
  rationaleSystemPrompt,
  rationaleUserPayload,
} from "./rationale";
import { RecommendationItem, RecommendationWindow, ScoredLocation } from "./types";

@Injectable()
export class RationaleService {
  constructor(private readonly omlx: OmlxClient) {}

  /**
   * German Begründung per location. The model only wins when its text stays
   * on the supplied Brain evidence. Otherwise the item is marked heuristic.
   */
  async write(
    pattern: AnalysisPattern,
    window: RecommendationWindow,
    items: ScoredLocation[],
  ): Promise<Omit<RecommendationItem, "rank">[]> {
    const heuristic = items.map((item) => ({
      ...item,
      rationale: buildHeuristicRationale(item),
      source: "heuristic" as const,
    }));
    if (items.length === 0 || !this.omlx.llmEnabled()) return heuristic;

    const completed = await this.omlx.complete(
      rationaleSystemPrompt(),
      rationaleUserPayload(pattern, window, items),
    );
    if (!completed.ok) return heuristic;

    const accepted = acceptRationales(completed.content, items, window);
    return heuristic.map((item) => {
      const rationale = accepted.get(item.id);
      if (!rationale) return item;
      return { ...item, rationale, source: "llm" as const };
    });
  }
}

import { AnalysisPattern } from "../analysis/types";
import { OmlxClient } from "../analysis/omlx.client";
import {
  acceptRationales,
  buildHeuristicRationale,
  rationaleIsGrounded,
} from "./rationale";
import { RationaleService } from "./rationale.service";
import { ScoredLocation } from "./types";

const window = { from: "2026-04", to: "2026-09" };

const pattern: AnalysisPattern = {
  source: "heuristic",
  summary: "Einwohner und Haushalte steigen mit dem Umsatz.",
  revenueDirection: "up",
  criteria: [{ key: "einwohner", label: "einwohner", direction: "up", evidence: "steigt" }],
};

function item(): ScoredLocation {
  return {
    id: "plz5:80801",
    title: "Schwabing",
    location: { geoKey: "80801", grain: "plz5", lon: 11.5, lat: 48.1, name: "Schwabing" },
    score: 1,
    criteriaEvidence: [
      {
        key: "einwohner",
        label: "einwohner",
        direction: "up",
        patternDirection: "up",
        evidence: "einwohner steigt in den letzten sechs Monaten (2026-04: 10; 2026-09: 20).",
      },
    ],
  };
}

describe("recommendation rationales", () => {
  it("writes a German heuristic that cites the location and the series", () => {
    const text = buildHeuristicRationale(item());
    expect(text).toContain("Schwabing");
    expect(text).toContain("80801");
    expect(text).toContain("einwohner");
    expect(text).toContain("2026-04");
    expect(text).toContain("Quelle: Heuristik, ohne Sprachmodell.");
  });

  it("accepts model text that stays on the evidence and rejects invented numbers", () => {
    const grounded =
      "In Schwabing steigt einwohner in den letzten sechs Monaten von 10 auf 20 und passt damit zum Muster.";
    expect(rationaleIsGrounded(grounded, item(), window)).toBe(true);
    expect(
      rationaleIsGrounded(
        "In Schwabing leben inzwischen 99999 Menschen, deshalb passt der Standort.",
        item(),
        window,
      ),
    ).toBe(false);

    const accepted = acceptRationales(
      JSON.stringify({ items: [{ id: "plz5:80801", rationale: grounded }] }),
      [item()],
      window,
    );
    expect(accepted.get("plz5:80801")).toBe(grounded);
    expect(
      acceptRationales('{"items":[{"id":"plz5:80801","rationale":"kurz"}]}', [item()], window).size,
    ).toBe(0);
  });
});

describe("RationaleService", () => {
  const llmEnabled = jest.fn();
  const complete = jest.fn();
  const service = new RationaleService({ llmEnabled, complete } as unknown as OmlxClient);

  beforeEach(() => {
    llmEnabled.mockReset();
    complete.mockReset();
  });

  it("does not call the model when it is unconfigured", async () => {
    llmEnabled.mockReturnValue(false);
    const written = await service.write(pattern, window, [item()]);
    expect(complete).not.toHaveBeenCalled();
    expect(written[0]?.source).toBe("heuristic");
  });

  it("marks a grounded model answer as llm and keeps a bad one heuristic", async () => {
    llmEnabled.mockReturnValue(true);
    complete.mockResolvedValue({
      ok: true,
      content: JSON.stringify({
        items: [
          {
            id: "plz5:80801",
            rationale:
              "In Schwabing steigt einwohner von 10 auf 20. Das entspricht dem Muster.",
          },
        ],
      }),
    });
    const written = await service.write(pattern, window, [item()]);
    expect(written[0]?.source).toBe("llm");
    expect(written[0]?.rationale).toContain("Schwabing");

    complete.mockResolvedValue({
      ok: true,
      content: JSON.stringify({
        items: [{ id: "plz5:80801", rationale: "In Schwabing gibt es 99999 Einwohner." }],
      }),
    });
    const fallback = await service.write(pattern, window, [item()]);
    expect(fallback[0]?.source).toBe("heuristic");
    expect(fallback[0]?.rationale).toContain("Heuristik");
  });
});

import { AnalysisPattern } from "../analysis/types";
import { OmlxClient } from "../analysis/omlx.client";
import {
  acceptRationales,
  buildHeuristicRationale,
  rationaleIsGrounded,
  rationaleUserPayload,
} from "./rationale";
import { RationaleService } from "./rationale.service";
import { ScoredLocation } from "./types";

const window = { from: "2023", to: "2025" };

const pattern: AnalysisPattern = {
  source: "heuristic",
  summary: "Unfälle fallen mit dem Umsatz.",
  revenueDirection: "up",
  criteria: [{ key: "unfallatlas", label: "Unfälle", direction: "down", evidence: "fällt", kind: "trend" }],
};

function item(): ScoredLocation {
  return {
    id: "other:ortsteil:osm:1",
    title: "Schwabing",
    kind: "ortsteil",
    grain: "other",
    name: "Schwabing",
    parentLabel: "München",
    targetRegionGeoKey: "09162000",
    dataAsOf: "2025",
    location: { geoKey: "ortsteil:osm:1", grain: "other", lon: 11.5, lat: 48.1, name: "Schwabing" },
    score: 1,
    criteriaEvidence: [
      {
        key: "unfallatlas",
        label: "Unfälle",
        direction: "down",
        patternDirection: "down",
        evidence: "Unfälle fällt im Dreijahresverlauf (2023: 20; 2025: 8).",
        kind: "trend",
        status: "present",
        match: true,
      },
    ],
  };
}

describe("recommendation rationales", () => {
  it("writes a German heuristic that cites the Teilfläche and the series", () => {
    const text = buildHeuristicRationale(item());
    expect(text).toContain("Teilfläche");
    expect(text).toContain("Schwabing");
    expect(text).not.toContain("ortsteil:osm:1");
    expect(text).not.toMatch(/lor:plr:/i);
    expect(text).toContain("Unfälle");
    expect(text).toContain("2023");
    expect(text).toContain("Quelle: Heuristik, ohne Sprachmodell.");
  });

  it("uses Planungsraum ohne Namen instead of a geoKey", () => {
    const nameless = item();
    nameless.kind = "lor";
    nameless.title = "lor:plr:01100310";
    nameless.name = "lor:plr:01100310";
    nameless.location.geoKey = "lor:plr:01100310";
    nameless.location.name = null;
    const text = buildHeuristicRationale(nameless);
    expect(text).toContain("Planungsraum ohne Namen");
    expect(text).not.toContain("lor:plr:01100310");
    expect(text).not.toMatch(/\(\s*lor:/);
  });

  it("does not send geoKey to the model and keeps keys out of heuristic copy", () => {
    const payload = JSON.parse(rationaleUserPayload(pattern, window, [item()])) as {
      items: Array<{ id: string; title: string; geoKey?: string }>;
    };
    expect(payload.items[0]?.id).toBe("other:ortsteil:osm:1");
    expect(payload.items[0]?.geoKey).toBeUndefined();
    expect(payload.items[0]?.title).toBe("Schwabing");
  });

  it("rejects model text that embeds a catalog key even when the rest is grounded", () => {
    const withKey =
      "In Schwabing (lor:plr:01100310) fallen Unfälle im Dreijahresverlauf von 20 auf 8.";
    expect(rationaleIsGrounded(withKey, item(), window)).toBe(false);
    expect(
      acceptRationales(
        JSON.stringify({ items: [{ id: "other:ortsteil:osm:1", rationale: withKey }] }),
        [item()],
        window,
      ).size,
    ).toBe(0);
  });

  it("accepts model text that stays on the evidence and rejects invented numbers", () => {
    const grounded =
      "In Schwabing fallen Unfälle im Dreijahresverlauf von 20 auf 8 und passen damit zum Filialmuster.";
    expect(rationaleIsGrounded(grounded, item(), window)).toBe(true);
    expect(
      rationaleIsGrounded(
        "In Schwabing leben inzwischen 99999 Menschen, deshalb passt der Standort.",
        item(),
        window,
      ),
    ).toBe(false);

    const accepted = acceptRationales(
      JSON.stringify({ items: [{ id: "other:ortsteil:osm:1", rationale: grounded }] }),
      [item()],
      window,
    );
    expect(accepted.get("other:ortsteil:osm:1")).toBe(grounded);
    expect(
      acceptRationales('{"items":[{"id":"other:ortsteil:osm:1","rationale":"kurz"}]}', [item()], window).size,
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
            id: "other:ortsteil:osm:1",
            rationale:
              "In Schwabing fallen Unfälle von 20 auf 8. Das entspricht dem Muster.",
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
        items: [{ id: "other:ortsteil:osm:1", rationale: "In Schwabing gibt es 99999 Einwohner." }],
      }),
    });
    const fallback = await service.write(pattern, window, [item()]);
    expect(fallback[0]?.source).toBe("heuristic");
    expect(fallback[0]?.rationale).toContain("Heuristik");
  });
});

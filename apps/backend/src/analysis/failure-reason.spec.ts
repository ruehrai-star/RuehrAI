import {
  analysisDeadlineError,
  asAnalysisRunFailureReason,
  mapAnalysisFailureReason,
} from "./failure-reason";

describe("mapAnalysisFailureReason", () => {
  it("maps the closed enum by phase and deadline", () => {
    expect(mapAnalysisFailureReason(analysisDeadlineError(), "pattern")).toBe("timeout");
    expect(mapAnalysisFailureReason(Object.assign(new Error("canceling statement"), { code: "57014" }), "set")).toBe(
      "timeout",
    );
    expect(mapAnalysisFailureReason(new Error("embeddings exploded"), "pattern")).toBe("pattern_failed");
    expect(mapAnalysisFailureReason(new Error("JSON stringify"), "set")).toBe("set_save_failed");
    expect(mapAnalysisFailureReason(new Error("boot"), "startup")).toBe("interrupted");
    expect(mapAnalysisFailureReason(new Error("other"), "unknown")).toBe("internal_error");
  });

  it("never returns a German technical message", () => {
    expect(asAnalysisRunFailureReason("Die Analyse ist fehlgeschlagen. Bitte erneut versuchen.")).toBe(
      "internal_error",
    );
    expect(asAnalysisRunFailureReason("timeout")).toBe("timeout");
    expect(asAnalysisRunFailureReason(null)).toBeNull();
  });
});

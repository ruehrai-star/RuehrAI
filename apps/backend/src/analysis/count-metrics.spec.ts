import {
  formatMetricNumber,
  isCountMetricKey,
  isRateLikeKey,
  roundCountMetricValue,
} from "./count-metrics";

describe("count-metrics", () => {
  it("treats dwellings, population, and people keys as counts", () => {
    expect(isCountMetricKey("wohnungen")).toBe(true);
    expect(isCountMetricKey("indicators.wohnungen")).toBe(true);
    expect(isCountMetricKey("ewz")).toBe(true);
    expect(isCountMetricKey("einwohner")).toBe(true);
    expect(isCountMetricKey("haushalte")).toBe(true);
    expect(isCountMetricKey("bedarfsgemeinschaften")).toBe(true);
    expect(isCountMetricKey("personen", "ba_sgb2")).toBe(true);
    expect(isCountMetricKey("value", "destatis_wohnungen")).toBe(true);
  });

  it("leaves genuine rates, shares, and areas unrounded", () => {
    expect(isRateLikeKey("pkw_elektro_anteil")).toBe(true);
    expect(isCountMetricKey("pkw_elektro_anteil", "kba_elektro_pkw")).toBe(false);
    expect(isCountMetricKey("leerstandsquote")).toBe(false);
    expect(isCountMetricKey("wohnflaeche_1000qm", "destatis_wohnungen")).toBe(false);
    expect(isCountMetricKey("miete")).toBe(false);
    expect(isCountMetricKey("kaufkraft")).toBe(false);
    expect(roundCountMetricValue("pkw_elektro_anteil", 4.133, "kba_elektro_pkw")).toBe(4.133);
    expect(roundCountMetricValue("wohnflaeche_1000qm", 80.4, "destatis_wohnungen")).toBe(80.4);
  });

  it("rounds interpolated count floats the way yearlySeries rounds SGB2", () => {
    expect(roundCountMetricValue("wohnungen", 413771.33)).toBe(413771);
    expect(roundCountMetricValue("ewz", 742286.33)).toBe(742286);
    expect(roundCountMetricValue("bedarfsgemeinschaften", 230216.522, "ba_sgb2")).toBe(230217);
    expect(roundCountMetricValue("einwohner", 1500000)).toBe(1500000);
  });

  it("formats German counts without decimals and keeps rate fractions", () => {
    expect(formatMetricNumber("wohnungen", 413771.33)).toBe("413.771");
    expect(formatMetricNumber("ewz", 742286.33)).toBe("742.286");
    expect(formatMetricNumber("pkw_elektro_anteil", 4.1)).toBe("4,1");
  });
});

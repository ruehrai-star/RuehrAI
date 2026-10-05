import {
  compactMetricKey,
  displayMetricLabel,
  displayPeriodStamp,
  formatMetricNumber,
  isCountMetricKey,
  isRateLikeKey,
  leafMetricKey,
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
    expect(isCountMetricKey("kinder")).toBe(true);
    expect(isCountMetricKey("senioren")).toBe(true);
  });

  it("treats every age-band person count as a count, not only one band", () => {
    expect(isCountMetricKey("alter_40_59")).toBe(true);
    expect(isCountMetricKey("alter 40 59")).toBe(true);
    expect(isCountMetricKey("alter.40.59")).toBe(true);
    expect(isCountMetricKey("alter-25-39")).toBe(true);
    expect(isCountMetricKey("indicators.alter_25_39")).toBe(true);
    expect(isCountMetricKey("bev_alter_18_24")).toBe(true);
    expect(isCountMetricKey("altersgruppe_0_17")).toBe(true);
    expect(isCountMetricKey("altersband_60_plus")).toBe(true);
    expect(isCountMetricKey("alter_60_plus")).toBe(true);
    expect(isCountMetricKey("alter_65u")).toBe(true);
    expect(isCountMetricKey("age_40_59")).toBe(true);
    expect(isCountMetricKey("ALT040B059")).toBe(true);
    expect(leafMetricKey("alter.40.59")).toBe("alter.40.59");
    expect(leafMetricKey("indicators.wohnungen")).toBe("wohnungen");
    expect(compactMetricKey("alter 40 59")).toBe("alter_40_59");
    expect(compactMetricKey("alter.40.59")).toBe("alter_40_59");
  });

  it("leaves genuine rates, shares, averages, and areas unrounded", () => {
    expect(isRateLikeKey("pkw_elektro_anteil")).toBe(true);
    expect(isCountMetricKey("pkw_elektro_anteil", "kba_elektro_pkw")).toBe(false);
    expect(isCountMetricKey("leerstandsquote")).toBe(false);
    expect(isCountMetricKey("wohnflaeche_1000qm", "destatis_wohnungen")).toBe(false);
    expect(isCountMetricKey("miete")).toBe(false);
    expect(isCountMetricKey("kaufkraft")).toBe(false);
    expect(isCountMetricKey("altersquote")).toBe(false);
    expect(isCountMetricKey("altersquotient")).toBe(false);
    expect(isCountMetricKey("durchschnittsalter")).toBe(false);
    expect(isCountMetricKey("medianalter")).toBe(false);
    expect(isCountMetricKey("alter_40_59_anteil")).toBe(false);
    expect(roundCountMetricValue("pkw_elektro_anteil", 4.133, "kba_elektro_pkw")).toBe(4.133);
    expect(roundCountMetricValue("wohnflaeche_1000qm", 80.4, "destatis_wohnungen")).toBe(80.4);
    expect(roundCountMetricValue("durchschnittsalter", 42.7)).toBe(42.7);
  });

  it("rounds interpolated count floats the way yearlySeries rounds SGB2", () => {
    expect(roundCountMetricValue("wohnungen", 413771.33)).toBe(413771);
    expect(roundCountMetricValue("ewz", 742286.33)).toBe(742286);
    expect(roundCountMetricValue("bedarfsgemeinschaften", 230216.522, "ba_sgb2")).toBe(230217);
    expect(roundCountMetricValue("einwohner", 1500000)).toBe(1500000);
    expect(roundCountMetricValue("alter_40_59", 206273.67)).toBe(206274);
    expect(roundCountMetricValue("alter 40 59", 206273.67)).toBe(206274);
    expect(roundCountMetricValue("alter.40.59", 206273.67)).toBe(206274);
    expect(roundCountMetricValue("alter_25_39", 180411.4)).toBe(180411);
  });

  it("formats German counts without decimals and keeps rate fractions", () => {
    expect(formatMetricNumber("wohnungen", 413771.33)).toBe("413.771");
    expect(formatMetricNumber("ewz", 742286.33)).toBe("742.286");
    expect(formatMetricNumber("alter 40 59", 206273.67)).toBe("206.274");
    expect(formatMetricNumber("pkw_elektro_anteil", 4.1)).toBe("4,1");
  });

  it("labels nested raeume as Räume rather than Wohnungen", () => {
    expect(displayMetricLabel("raeume")).toBe("Räume");
    expect(displayMetricLabel("wohnungen.raeume")).toBe("Räume");
    expect(displayMetricLabel("alter.40.59")).toBe("alter 40 59");
    expect(displayMetricLabel("alter_40_59")).toBe("alter 40 59");
    expect(displayMetricLabel("wohnungen")).toBe("wohnungen");
  });

  it("rewrites parent Brain period suffixes to the nested leaf in evidence stamps", () => {
    expect(displayPeriodStamp("2020|wohnungen", "wohnungen.raeume")).toBe("2020|Räume");
    expect(displayPeriodStamp("2020|wohnungen", "raeume")).toBe("2020|Räume");
    expect(displayPeriodStamp("2024|indicators", "indicators.wohnungen")).toBe("2024|wohnungen");
    expect(displayPeriodStamp("2020|wohnungen", "wohnungen")).toBe("2020|wohnungen");
    expect(displayPeriodStamp("2025-12|bka", "einwohner")).toBe("2025-12|bka");
    expect(displayPeriodStamp("2022|bev_alter", "alter.40.59")).toBe("2022|bev_alter");
    expect(displayPeriodStamp("2022-05", "wohnungen.raeume")).toBe("2022-05");
    expect(displayPeriodStamp("", "raeume")).toBe("ohne Zeitraum");
  });
});

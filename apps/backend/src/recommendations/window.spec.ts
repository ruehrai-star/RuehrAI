import { lastSixMonths, monthKey } from "./window";

describe("recommendation window", () => {
  it("uses the six UTC months ending in the request month", () => {
    expect(lastSixMonths(new Date("2026-09-29T22:00:00.000Z"))).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
  });

  it("crosses the year boundary", () => {
    expect(lastSixMonths(new Date("2026-02-01T00:00:00.000Z"))[0]).toBe("2025-09");
    expect(lastSixMonths(new Date("2026-02-01T00:00:00.000Z"))[5]).toBe("2026-02");
  });

  it("reads YYYY-MM from a Brain ref_period", () => {
    expect(monthKey("2026-04")).toBe("2026-04");
    expect(monthKey(" 2026-09-15 ")).toBe("2026-09");
    expect(monthKey("2022")).toBeNull();
    expect(monthKey(null)).toBeNull();
  });
});

import { monthKey, threeYearWindow } from "./window";

describe("recommendation window", () => {
  it("uses three calendar years, not six months", () => {
    expect(threeYearWindow(new Date("2026-09-29T22:00:00.000Z"))).toEqual({
      from: "2024",
      to: "2026",
    });
    expect(threeYearWindow(new Date("2026-09-29T22:00:00.000Z"), [2023, 2024, 2025])).toEqual({
      from: "2023",
      to: "2025",
    });
  });

  it("reads YYYY-MM from a Brain ref_period", () => {
    expect(monthKey("2026-04")).toBe("2026-04");
    expect(monthKey(" 2026-09-15 ")).toBe("2026-09");
    expect(monthKey("2022")).toBeNull();
    expect(monthKey(null)).toBeNull();
  });
});

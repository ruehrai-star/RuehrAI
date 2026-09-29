import { hasAdjacentRevenue, latestPoints, monthChanges, revenueDirection } from "./revenue-series";

describe("revenue series", () => {
  it("counts a change only between successive calendar months", () => {
    const points = [
      { year: 2024, month: 12, revenueEur: 100 },
      { year: 2025, month: 1, revenueEur: 80 },
      { year: 2025, month: 2, revenueEur: null },
      { year: 2025, month: 3, revenueEur: 90 },
    ];
    expect(monthChanges(points)).toEqual([
      {
        fromYear: 2024,
        fromMonth: 12,
        toYear: 2025,
        toMonth: 1,
        fromRevenueEur: 100,
        toRevenueEur: 80,
        changeEur: -20,
      },
    ]);
    expect(hasAdjacentRevenue(points)).toBe(true);
    expect(revenueDirection(monthChanges(points))).toBe("down");
  });

  it("treats a gap as insufficient for that pair", () => {
    const points = [
      { year: 2025, month: 1, revenueEur: 10 },
      { year: 2025, month: 3, revenueEur: 30 },
    ];
    expect(hasAdjacentRevenue(points)).toBe(false);
    expect(revenueDirection(monthChanges(points))).toBe("flat");
  });

  it("keeps the latest 36 months", () => {
    const points = Array.from({ length: 40 }, (_, index) => ({
      year: 2020 + Math.floor(index / 12),
      month: (index % 12) + 1,
      revenueEur: index,
    }));
    const latest = latestPoints(points);
    expect(latest).toHaveLength(36);
    expect(latest[0]).toMatchObject({ year: 2020, month: 5 });
    expect(latest.at(-1)).toMatchObject({ year: 2023, month: 4 });
  });
});

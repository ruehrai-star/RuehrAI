import { storedRowValue, zensus2022Value } from "./value";

describe("address-pair stored values", () => {
  it("keeps a stored 0 and drops null cells", () => {
    expect(storedRowValue({ count: 0, missing: null, empty: undefined, label: "ok" })).toEqual({
      count: 0,
      label: "ok",
    });
  });

  it("adds zensus gebaeude and wohnungen only when those cells exist", () => {
    expect(
      zensus2022Value([
        { einwohner: 1480000 },
        { gebaeude: 1840 },
        { note: "wohnungen absent" },
      ]),
    ).toEqual({ einwohner: 1480000, gebaeude: 1840, note: "wohnungen absent" });
  });

  it("does not invent a zero for a missing zensus cell", () => {
    expect(zensus2022Value([{ personen: 12 }])).toEqual({ personen: 12 });
    expect(zensus2022Value([])).toBeUndefined();
  });
});

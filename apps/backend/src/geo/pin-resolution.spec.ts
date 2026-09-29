import { nextStoredPin } from "./pin-resolution";

const address = { lon: 13.31, lat: 52.48 };
const centroid = { lon: 13.387, lat: 52.532 };

describe("nextStoredPin", () => {
  it("fills a null pin from the address hit", () => {
    expect(
      nextStoredPin({
        stored: { lon: null, lat: null },
        address,
        plzCentroids: [centroid],
      }),
    ).toEqual({ point: address, source: "address" });
  });

  it("upgrades a stored PLZ centroid to the address hit", () => {
    expect(
      nextStoredPin({
        stored: centroid,
        address,
        plzCentroids: [centroid],
      }),
    ).toEqual({ point: address, source: "address" });
  });

  it("keeps an explicit pin that is not the PLZ centroid", () => {
    expect(
      nextStoredPin({
        stored: { lon: 13.4, lat: 52.5 },
        address,
        plzCentroids: [centroid],
      }),
    ).toBeNull();
  });

  it("fills a null pin from the PLZ centroid when the address misses", () => {
    expect(
      nextStoredPin({
        stored: { lon: null, lat: null },
        address: null,
        plzCentroids: [centroid],
      }),
    ).toEqual({ point: centroid, source: "plz" });
  });
});

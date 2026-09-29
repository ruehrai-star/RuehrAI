import { BadRequestException } from "@nestjs/common";
import {
  boundsFromGeometry,
  centroid,
  geometryFromUnknown,
  parseRegionGeometry,
  resolveRegionMap,
  stubPolygon,
} from "./region-geometry";

const square = {
  type: "Polygon" as const,
  coordinates: [
    [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ],
  ],
};

describe("region geometry", () => {
  it("derives bounds and a centroid from a closed polygon", () => {
    const geometry = parseRegionGeometry(square);
    expect(boundsFromGeometry(geometry)).toEqual({ west: 0, south: 0, east: 2, north: 2 });
    expect(centroid(geometry)).toEqual({ lon: 1, lat: 1 });
  });

  it("spans every part of a MultiPolygon", () => {
    const geometry = parseRegionGeometry({
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
        [
          [
            [3, 4],
            [4, 4],
            [4, 5],
            [3, 5],
            [3, 4],
          ],
        ],
      ],
    });
    expect(boundsFromGeometry(geometry)).toEqual({ west: 0, south: 0, east: 4, north: 5 });
  });

  it("rejects an open ring and a point", () => {
    expect(() =>
      parseRegionGeometry({
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        ],
      }),
    ).toThrow(BadRequestException);
    expect(() => parseRegionGeometry({ type: "Point", coordinates: [11, 48] })).toThrow(
      BadRequestException,
    );
    expect(geometryFromUnknown({ type: "Point", coordinates: [11, 48] })).toBeNull();
  });

  it("prefers client geometry over the catalog", () => {
    const resolved = resolveRegionMap({
      grain: "ags",
      lon: null,
      lat: null,
      bounds: { west: 9, south: 9, east: 10, north: 10 },
      geometry: square,
      catalogGeometry: null,
      catalogPoint: { lon: 11, lat: 48 },
    });
    expect(resolved.geometry).toEqual(square);
    expect(resolved.bounds).toEqual({ west: 0, south: 0, east: 2, north: 2 });
    expect(resolved.lon).toBe(1);
    expect(resolved.lat).toBe(1);
  });

  it("builds an ags-sized stub around a catalog point", () => {
    const resolved = resolveRegionMap({
      grain: "ags",
      lon: null,
      lat: null,
      bounds: null,
      geometry: null,
      catalogGeometry: null,
      catalogPoint: { lon: 13.405, lat: 52.52 },
    });
    expect(resolved.geometry).toEqual(stubPolygon(13.405, 52.52, "ags"));
    expect(resolved.bounds).toEqual({
      west: 13.405 - 0.18,
      south: 52.52 - 0.095,
      east: 13.405 + 0.18,
      north: 52.52 + 0.095,
    });
  });
});

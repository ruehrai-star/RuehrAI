import assert from "node:assert/strict";
import { test } from "node:test";
import { coordinatesOf, pointFromGeometry } from "./geo.ts";

test("point geometry and null coordinates", () => {
  assert.deepEqual(pointFromGeometry({ type: "Point", coordinates: [13.405, 52.52] }), {
    lon: 13.405,
    lat: 52.52,
  });
  assert.equal(coordinatesOf({ lon: null, lat: null }), null);
  assert.equal(coordinatesOf({}), null);
  assert.equal(coordinatesOf({ lon: Number.NaN, lat: 48 }), null);
  assert.deepEqual(coordinatesOf({ lon: "11.575", lat: " 48.137 " }), { lon: 11.575, lat: 48.137 });
  assert.equal(coordinatesOf({ lon: "", lat: "48.1" }), null);
  assert.equal(coordinatesOf({ lon: "nein", lat: "48.1" }), null);
});

test("polygon centroid ignores the closing vertex", () => {
  const point = pointFromGeometry({
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
        [0, 0],
      ],
    ],
  });
  assert.deepEqual(point, { lon: 1, lat: 1 });
});

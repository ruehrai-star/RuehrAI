import assert from "node:assert/strict";
import { test } from "node:test";
import type { Recommendation, StoreLocation, TargetRegion } from "@ruehrai/api-contracts";
import {
  EMPFEHLUNG_COLOR,
  FIT_PADDING_PX,
  LEGEND_LABEL,
  MISSING_AREA_LABEL,
  NO_STORES_LABEL,
  PIN_COLOR,
  REGION_FILL,
  REGION_FILL_OPACITY,
  buildKarte,
  coordinateGapLabel,
} from "./karte.ts";

const MUNICH_BOX = {
  type: "Polygon",
  coordinates: [
    [
      [11, 48],
      [12, 48],
      [12, 49],
      [11, 49],
      [11, 48],
    ],
  ],
};

test("padding, legend and pin colors stay distinct and readable", () => {
  assert.ok(FIT_PADDING_PX >= 40);
  assert.equal(NO_STORES_LABEL, "Noch keine Filialadressen");
  assert.equal(LEGEND_LABEL, "Zielregion");
  assert.equal(MISSING_AREA_LABEL, "Zielregion ist gesetzt. Die Fläche kann noch nicht gezeichnet werden.");
  assert.ok(REGION_FILL_OPACITY > 0 && REGION_FILL_OPACITY < 0.5);
  assert.notEqual(PIN_COLOR, EMPFEHLUNG_COLOR);
  assert.notEqual(PIN_COLOR, REGION_FILL);
  assert.notEqual(EMPFEHLUNG_COLOR, REGION_FILL);
  for (const label of [
    NO_STORES_LABEL,
    LEGEND_LABEL,
    MISSING_AREA_LABEL,
    "Empfehlung",
    "1 Filialadresse ohne Koordinaten.",
    "3 Filialadressen ohne Koordinaten. Deshalb erscheinen sie nicht auf der Karte.",
  ]) {
    assert.doesNotMatch(label, /\b(pin|marker|store|target region|area|error|fehler)\b/i);
  }
});

test("saved addresses become Stecknadeln with a German address popup", () => {
  const model = buildKarte({
    stores: [
      store({ id: "1", street: "Marienplatz 1", postalCode: "80331", city: "München", lon: 11.575, lat: 48.137 }),
      store({ id: "2", street: "Alexanderplatz 1", postalCode: "10178", city: "Berlin", lon: 13.413, lat: 52.522 }),
    ],
    region: null,
    recommendations: [],
    addressesKnownEmpty: false,
  });

  assert.equal(model.pins.length, 2);
  assert.equal(model.pins[0]?.kind, "bestand");
  assert.equal(model.pins[0]?.street, "Marienplatz 1");
  assert.equal(model.pins[0]?.place, "80331 München");
  assert.equal(model.pins[0]?.ariaLabel, "Marienplatz 1, 80331 München");
  assert.equal(model.pins[1]?.place, "10178 Berlin");
  assert.equal(model.showEmptyAddresses, false);
  assert.equal(model.coordinateGapLabel, null);
  assert.equal(model.missingAreaLabel, null);
  assert.equal(model.showLegend, false);
  assert.equal(model.camera.kind, "bounds");
  if (model.camera.kind === "bounds") {
    assert.equal(model.camera.bounds.west, 11.575);
    assert.equal(model.camera.bounds.south, 48.137);
    assert.equal(model.camera.bounds.east, 13.413);
    assert.equal(model.camera.bounds.north, 52.522);
  }
});

test("addresses without coordinates stay pinned when a pair exists and are not the empty state", () => {
  const stores = [
    store({ id: "1", street: "Weg 1", lon: 11.5, lat: 48.1 }),
    store({ id: "2", street: "Weg 2", lon: null, lat: null }),
  ];
  const model = buildKarte({
    stores,
    region: null,
    recommendations: [],
    addressesKnownEmpty: true,
  });
  assert.deepEqual(
    model.pins.map((pin) => pin.id),
    ["1"],
  );
  assert.equal(model.showEmptyAddresses, false);
  assert.equal(model.coordinateGapLabel, "1 Filialadresse ohne Koordinaten.");
  assert.notEqual(model.coordinateGapLabel, NO_STORES_LABEL);
  assert.equal(model.camera.kind, "bounds");
  assert.equal(coordinateGapLabel(stores), model.coordinateGapLabel);
});

test("saved addresses with no coordinates use the coordinate hint, not the empty copy", () => {
  const model = buildKarte({
    stores: [
      store({ id: "1", street: "Weg 1", lon: null, lat: null }),
      store({ id: "2", street: "Weg 2", lon: null, lat: null }),
      store({ id: "3", street: "Weg 3", lon: null, lat: null }),
    ],
    region: null,
    recommendations: [],
    addressesKnownEmpty: true,
  });
  assert.equal(model.pins.length, 0);
  assert.equal(model.showEmptyAddresses, false);
  assert.equal(model.coordinateGapLabel, "3 Filialadressen ohne Koordinaten. Deshalb erscheinen sie nicht auf der Karte.");
  assert.equal(
    coordinateGapLabel([store({ id: "1", street: "Weg 1", lon: null, lat: null })]),
    "1 Filialadresse ohne Koordinaten. Deshalb erscheint sie nicht auf der Karte.",
  );
  assert.notEqual(model.coordinateGapLabel, NO_STORES_LABEL);
  assert.equal(model.camera.kind, "germany");
  assert.doesNotMatch(model.coordinateGapLabel ?? "", /\b(pin|marker|store|geocod)/i);
});

test("a numeric coordinate string is a pin and a blank pair is not", () => {
  const model = buildKarte({
    stores: [
      store({ id: "1", street: "Weg 1", lon: "11.575" as unknown as number, lat: "48.137" as unknown as number }),
      store({ id: "2", street: "Weg 2", lon: " " as unknown as number, lat: "" as unknown as number }),
    ],
    region: null,
    recommendations: [],
    addressesKnownEmpty: false,
  });
  assert.equal(model.pins.length, 1);
  assert.equal(model.pins[0]?.id, "1");
  assert.equal(model.pins[0]?.lon, 11.575);
  assert.equal(model.pins[0]?.lat, 48.137);
  assert.equal(model.showEmptyAddresses, false);
  assert.equal(model.coordinateGapLabel, "1 Filialadresse ohne Koordinaten.");
});

test("no saved addresses use the empty label and the Germany overview", () => {
  const model = buildKarte({
    stores: [],
    region: null,
    recommendations: [],
    addressesKnownEmpty: true,
  });
  assert.equal(model.showEmptyAddresses, true);
  assert.equal(model.pins.length, 0);
  assert.equal(model.camera.kind, "germany");
  assert.equal(model.showLegend, false);
  assert.equal(model.missingAreaLabel, null);
});

test("an unknown address list does not claim the empty state", () => {
  const model = buildKarte({
    stores: [],
    region: null,
    recommendations: [],
    addressesKnownEmpty: false,
  });
  assert.equal(model.showEmptyAddresses, false);
  assert.equal(model.camera.kind, "germany");
});

test("Zielregion geometry is a fill and the camera frames addresses plus the area", () => {
  const model = buildKarte({
    stores: [store({ id: "1", street: "Weg 1", lon: 13.4, lat: 52.5 })],
    region: region({ geometry: MUNICH_BOX, bounds: { west: 11, south: 47.5, east: 12, north: 49 } }),
    recommendations: [],
    addressesKnownEmpty: false,
  });
  assert.equal(model.showLegend, true);
  assert.equal(model.missingAreaLabel, null);
  assert.equal(model.region.features.length, 1);
  assert.deepEqual(model.region.features[0]?.geometry, MUNICH_BOX);
  assert.equal(model.camera.kind, "bounds");
  if (model.camera.kind === "bounds") {
    assert.equal(model.camera.bounds.west, 11);
    assert.equal(model.camera.bounds.south, 47.5);
    assert.equal(model.camera.bounds.east, 13.4);
    assert.equal(model.camera.bounds.north, 52.5);
  }
});

test("OpenAPI LonLatBounds frame the camera and a bbox array does not", () => {
  const named = buildKarte({
    stores: [],
    region: region({ bounds: { west: 11, south: 48, east: 12, north: 49 } }),
    recommendations: [],
    addressesKnownEmpty: false,
  });
  assert.equal(named.showLegend, false);
  assert.equal(named.missingAreaLabel, MISSING_AREA_LABEL);
  assert.equal(named.region.features.length, 0);
  assert.equal(named.camera.kind, "bounds");
  if (named.camera.kind === "bounds") {
    assert.deepEqual(named.camera.bounds, { west: 11, south: 48, east: 12, north: 49 });
  }

  const arrayBounds = buildKarte({
    stores: [],
    region: region({ bounds: [11, 48, 12, 49] }),
    recommendations: [],
    addressesKnownEmpty: false,
  });
  assert.equal(arrayBounds.showLegend, false);
  assert.equal(arrayBounds.missingAreaLabel, MISSING_AREA_LABEL);
  assert.equal(arrayBounds.region.features.length, 0);
  assert.equal(arrayBounds.camera.kind, "germany");
});

test("bounds alone show the missing-area hint and a point-only region does not fill", () => {
  const boundsOnly = buildKarte({
    stores: [],
    region: region({ bounds: { west: 11, south: 48, east: 12, north: 49 } }),
    recommendations: [],
    addressesKnownEmpty: false,
  });
  assert.equal(boundsOnly.showLegend, false);
  assert.equal(boundsOnly.missingAreaLabel, MISSING_AREA_LABEL);
  assert.equal(boundsOnly.region.features.length, 0);
  assert.equal(boundsOnly.camera.kind, "bounds");
  if (boundsOnly.camera.kind === "bounds") {
    assert.deepEqual(boundsOnly.camera.bounds, { west: 11, south: 48, east: 12, north: 49 });
  }

  const pointOnly = buildKarte({
    stores: [],
    region: region({
      lon: 11.5,
      lat: 48.1,
      geometry: { type: "Point", coordinates: [11.5, 48.1] },
    }),
    recommendations: [],
    addressesKnownEmpty: false,
  });
  assert.equal(pointOnly.showLegend, false);
  assert.equal(pointOnly.missingAreaLabel, MISSING_AREA_LABEL);
  assert.equal(pointOnly.region.features.length, 0);
  assert.equal(pointOnly.camera.kind, "bounds");
  if (pointOnly.camera.kind === "bounds") {
    assert.equal(pointOnly.camera.bounds.west, 11.5);
    assert.equal(pointOnly.camera.bounds.east, 11.5);
  }
});

test("MultiPolygon geometry is the overlay and other GeoJSON types are ignored", () => {
  const multi = buildKarte({
    stores: [],
    region: region({
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [11, 48],
              [12, 48],
              [12, 49],
              [11, 49],
              [11, 48],
            ],
          ],
        ],
      },
    }),
    recommendations: [],
    addressesKnownEmpty: false,
  });
  assert.equal(multi.showLegend, true);
  assert.equal(multi.missingAreaLabel, null);
  assert.equal(multi.region.features[0]?.geometry.type, "MultiPolygon");

  const wrapped = buildKarte({
    stores: [],
    region: region({
      geometry: {
        type: "FeatureCollection",
        features: [{ type: "Feature", geometry: MUNICH_BOX, properties: {} }],
      },
    }),
    recommendations: [],
    addressesKnownEmpty: false,
  });
  assert.equal(wrapped.showLegend, false);
  assert.equal(wrapped.missingAreaLabel, MISSING_AREA_LABEL);
  assert.equal(wrapped.region.features.length, 0);
  assert.equal(wrapped.camera.kind, "germany");

  const broken = buildKarte({
    stores: [],
    region: region({ geometry: { type: "Polygon", coordinates: "nein" }, bounds: { west: 1, south: 2, east: 0, north: 3 } }),
    recommendations: [],
    addressesKnownEmpty: false,
  });
  assert.equal(broken.showLegend, false);
  assert.equal(broken.missingAreaLabel, MISSING_AREA_LABEL);
  assert.equal(broken.region.features.length, 0);
  assert.equal(broken.camera.kind, "germany");
});

test("a set Zielregion without geometry or bounds shows the missing-area hint and no fill", () => {
  const stage = buildKarte({
    stores: [store({ id: "1", street: "Weg 1", lon: 11.58, lat: 48.14 })],
    region: region({
      label: "München",
      grain: "ags",
      ags: "09162000",
      lon: 11.575,
      lat: 48.137,
      geometry: null,
      bounds: null,
    }),
    recommendations: [],
    addressesKnownEmpty: false,
  });
  assert.equal(stage.region.features.length, 0);
  assert.equal(stage.showLegend, false);
  assert.equal(stage.missingAreaLabel, MISSING_AREA_LABEL);
  assert.equal(stage.camera.kind, "bounds");
  if (stage.camera.kind === "bounds") {
    assert.equal(stage.camera.bounds.west, 11.575);
    assert.equal(stage.camera.bounds.east, 11.58);
  }

  const noPoint = buildKarte({
    stores: [],
    region: region({ geometry: null, bounds: null, lon: null, lat: null }),
    recommendations: [],
    addressesKnownEmpty: false,
  });
  assert.equal(noPoint.region.features.length, 0);
  assert.equal(noPoint.showLegend, false);
  assert.equal(noPoint.missingAreaLabel, MISSING_AREA_LABEL);
  assert.equal(noPoint.camera.kind, "germany");
});

test("Top-3 Empfehlungen use a different color from Bestand pins", () => {
  const withTop3 = buildKarte({
    stores: [store({ id: "1", street: "Weg 1", lon: 11.5, lat: 48.1 })],
    region: null,
    recommendations: [recommendation("plz5:80801", "Schwabing", 11.58, 48.16)],
    addressesKnownEmpty: false,
  });
  assert.equal(withTop3.pins[0]?.kind, "bestand");
  assert.equal(withTop3.empfehlungen[0]?.kind, "empfehlung");
  assert.notEqual(PIN_COLOR, EMPFEHLUNG_COLOR);

  const bestandOnly = buildKarte({
    stores: [store({ id: "1", street: "Weg 1", lon: 11.5, lat: 48.1 })],
    region: null,
    recommendations: [],
    addressesKnownEmpty: false,
  });
  assert.equal(bestandOnly.empfehlungen.length, 0);
  assert.equal(bestandOnly.pins.length, 1);
});

test("recommendation points stay off the fit and use a different kind", () => {
  const model = buildKarte({
    stores: [store({ id: "1", street: "Weg 1", lon: 11.5, lat: 48.1 })],
    region: null,
    recommendations: [
      recommendation("plz5:80801", "Schwabing", 11.58, 48.16),
      recommendation("plz5:10115", "Mitte", null, null),
    ],
    addressesKnownEmpty: false,
  });
  assert.equal(model.empfehlungen.length, 1);
  assert.equal(model.empfehlungen[0]?.kind, "empfehlung");
  assert.equal(model.empfehlungen[0]?.ariaLabel, "Schwabing, Empfehlung");
  assert.notEqual(model.empfehlungen[0]?.kind, model.pins[0]?.kind);
  if (model.camera.kind === "bounds") {
    assert.equal(model.camera.bounds.east, 11.5);
    assert.equal(model.camera.bounds.north, 48.1);
  }
});

test("the camera key changes with address data and stays put for recommendations", () => {
  const base = {
    stores: [store({ id: "1", street: "Weg 1", lon: 11.5, lat: 48.1 })],
    region: region({ bounds: { west: 11, south: 48, east: 12, north: 49 } }),
    recommendations: [] as Recommendation[],
    addressesKnownEmpty: false,
  };
  const first = buildKarte(base);
  const again = buildKarte(base);
  assert.equal(first.cameraKey, again.cameraKey);

  const moved = buildKarte({
    ...base,
    stores: [store({ id: "1", street: "Weg 1", lon: 11.5, lat: 48.2, updatedAt: "2026-09-29T13:00:00.000Z" })],
  });
  assert.notEqual(moved.cameraKey, first.cameraKey);

  const withRecommendation = buildKarte({
    ...base,
    recommendations: [recommendation("plz5:80801", "Schwabing", 11.58, 48.16)],
  });
  assert.equal(withRecommendation.cameraKey, first.cameraKey);
  assert.notEqual(withRecommendation.markerKey, first.markerKey);
});

function store(partial: Partial<StoreLocation> & Pick<StoreLocation, "id" | "street">): StoreLocation {
  return {
    postalCode: "80331",
    city: "München",
    countryCode: "DE",
    label: null,
    lon: null,
    lat: null,
    createdAt: "2026-09-29T12:00:00.000Z",
    updatedAt: "2026-09-29T12:00:00.000Z",
    ...partial,
  };
}

function region(extra: Record<string, unknown>): TargetRegion {
  return {
    label: "München",
    grain: "ags",
    geoKey: "09162000",
    lon: null,
    lat: null,
    updatedAt: "2026-09-29T12:00:00.000Z",
    ...extra,
  } as TargetRegion;
}

function recommendation(id: string, title: string, lon: number | null, lat: number | null): Recommendation {
  return {
    id,
    rank: 1,
    title,
    location: { geoKey: id.split(":")[1] ?? id, grain: "plz5", lon, lat, name: null },
    score: 1,
    rationale: "Begründung",
    criteriaEvidence: [],
    source: "heuristic",
  };
}

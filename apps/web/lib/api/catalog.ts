import type { Feature, FeatureCollection, Polygon } from "geojson";
import type { Grain, SearchHit } from "./types";

/**
 * Synthetic fixtures for the mock client.
 * Grid ids follow the Zensus/INSPIRE pattern from docs/datenbasis
 * (`CRS3035RES100mN{northing}E{easting}`) but are not surveyed cells.
 * Polygons sit in the documented southern smoke band, near Friedrichshafen.
 * PLZ8 values are illustrative only.
 */

export const GRID_LAYER_ID = "grid100";

const COLS = 4;
const ROWS = 3;
const CELL_LON = 0.0014;
const CELL_LAT = 0.0009;
const ORIGIN_LON = 9.475;
const ORIGIN_LAT = 47.652;
const NORTHING0 = 2_761_400;
const EASTING0 = 4_268_700;

export interface CatalogEntry {
  id: string;
  label: string;
  grain: Grain;
  lon: number;
  lat: number;
  ags?: string;
  plz?: string;
  plz8?: string;
}

interface RankedHit {
  entry: CatalogEntry;
  score: number;
}

const PLACES: CatalogEntry[] = [
  {
    id: "ags:09162000",
    label: "München",
    grain: "ags",
    lon: 11.582,
    lat: 48.1351,
    ags: "09162000",
  },
  {
    id: "plz5:80331",
    label: "80331 München",
    grain: "plz5",
    lon: 11.5755,
    lat: 48.1372,
    plz: "80331",
    ags: "09162000",
  },
  {
    id: "plz8:80331001",
    label: "PLZ8 80331001 München-Altstadt",
    grain: "plz8",
    lon: 11.5762,
    lat: 48.1376,
    plz: "80331",
    plz8: "80331001",
    ags: "09162000",
  },
  {
    id: "80331|MUENCHEN|MARIENPLATZ|1|",
    label: "Marienplatz 1, 80331 München",
    grain: "address",
    lon: 11.5754,
    lat: 48.1372,
    plz: "80331",
    ags: "09162000",
  },
  {
    id: "ags:11000000",
    label: "Berlin",
    grain: "ags",
    lon: 13.405,
    lat: 52.52,
    ags: "11000000",
  },
  {
    id: "plz5:10178",
    label: "10178 Berlin",
    grain: "plz5",
    lon: 13.411,
    lat: 52.522,
    plz: "10178",
    ags: "11000000",
  },
  {
    id: "plz8:10178001",
    label: "PLZ8 10178001 Berlin-Mitte",
    grain: "plz8",
    lon: 13.412,
    lat: 52.5225,
    plz: "10178",
    plz8: "10178001",
    ags: "11000000",
  },
  {
    id: "10178|BERLIN|ALEXANDERPLATZ|1|",
    label: "Alexanderplatz 1, 10178 Berlin",
    grain: "address",
    lon: 13.4132,
    lat: 52.5219,
    plz: "10178",
    ags: "11000000",
  },
  {
    id: "ags:02000000",
    label: "Hamburg",
    grain: "ags",
    lon: 9.9937,
    lat: 53.5511,
    ags: "02000000",
  },
  {
    id: "plz5:20095",
    label: "20095 Hamburg",
    grain: "plz5",
    lon: 9.993,
    lat: 53.551,
    plz: "20095",
    ags: "02000000",
  },
  {
    id: "20095|HAMBURG|RATHAUSMARKT|1|",
    label: "Rathausmarkt 1, 20095 Hamburg",
    grain: "address",
    lon: 9.9922,
    lat: 53.5504,
    plz: "20095",
    ags: "02000000",
  },
  {
    id: "ags:05315000",
    label: "Köln",
    grain: "ags",
    lon: 6.9603,
    lat: 50.9375,
    ags: "05315000",
  },
  {
    id: "plz5:50667",
    label: "50667 Köln",
    grain: "plz5",
    lon: 6.957,
    lat: 50.941,
    plz: "50667",
    ags: "05315000",
  },
  {
    id: "ags:08111000",
    label: "Stuttgart",
    grain: "ags",
    lon: 9.1829,
    lat: 48.7758,
    ags: "08111000",
  },
  {
    id: "plz5:70173",
    label: "70173 Stuttgart",
    grain: "plz5",
    lon: 9.178,
    lat: 48.778,
    plz: "70173",
    ags: "08111000",
  },
  {
    id: "ags:08311000",
    label: "Freiburg im Breisgau",
    grain: "ags",
    lon: 7.8421,
    lat: 47.999,
    ags: "08311000",
  },
  {
    id: "plz5:79098",
    label: "79098 Freiburg im Breisgau",
    grain: "plz5",
    lon: 7.852,
    lat: 47.9955,
    plz: "79098",
    ags: "08311000",
  },
  {
    id: "79098|FREIBURG|MUENSTERPLATZ|1|",
    label: "Münsterplatz 1, 79098 Freiburg im Breisgau",
    grain: "address",
    lon: 7.8529,
    lat: 47.9956,
    plz: "79098",
    ags: "08311000",
  },
  {
    id: "ags:08435016",
    label: "Friedrichshafen",
    grain: "ags",
    lon: 9.4797,
    lat: 47.6567,
    ags: "08435016",
  },
  {
    id: "plz5:88045",
    label: "88045 Friedrichshafen",
    grain: "plz5",
    lon: 9.48,
    lat: 47.654,
    plz: "88045",
    ags: "08435016",
  },
  {
    id: "ags:08335043",
    label: "Konstanz",
    grain: "ags",
    lon: 9.1732,
    lat: 47.6603,
    ags: "08335043",
  },
  {
    id: "plz5:78462",
    label: "78462 Konstanz",
    grain: "plz5",
    lon: 9.175,
    lat: 47.663,
    plz: "78462",
    ags: "08335043",
  },
];

function gridEntries(): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const northing = NORTHING0 + row * 100;
      const easting = EASTING0 + col * 100;
      const id = `CRS3035RES100mN${northing}E${easting}`;
      entries.push({
        id,
        label: `100-m-Gitter Friedrichshafen · ${id}`,
        grain: "grid100",
        lon: ORIGIN_LON + col * CELL_LON + CELL_LON / 2,
        lat: ORIGIN_LAT + row * CELL_LAT + CELL_LAT / 2,
      });
    }
  }
  return entries;
}

const GRID = gridEntries();
const CATALOG: CatalogEntry[] = [...PLACES, ...GRID];

function fold(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll("ä", "a")
    .replaceAll("ö", "o")
    .replaceAll("ü", "u")
    .replaceAll("ß", "ss")
    .replaceAll("ae", "a")
    .replaceAll("oe", "o")
    .replaceAll("ue", "u");
}

function haystack(entry: CatalogEntry): string {
  return fold(
    [entry.label, entry.id, entry.ags, entry.plz, entry.plz8, entry.grain]
      .filter(Boolean)
      .join(" "),
  );
}

function scoreEntry(entry: CatalogEntry, tokens: string[], foldedQuery: string): number {
  const foldedLabel = fold(entry.label);
  const foldedId = fold(entry.id);
  const fields = haystack(entry);
  if (!tokens.every((token) => fields.includes(token))) {
    return 0;
  }

  let score = 0;
  if (
    entry.ags === foldedQuery ||
    entry.plz === foldedQuery ||
    entry.plz8 === foldedQuery ||
    foldedId === foldedQuery
  ) {
    score += 120;
  }
  if (foldedLabel.startsWith(foldedQuery)) {
    score += 50;
  }
  if (entry.grain === "ags" && foldedLabel === foldedQuery) {
    score += 30;
  }
  if (entry.grain === "plz5" || entry.grain === "plz8") {
    score += 4;
  }
  if (entry.grain === "address") {
    score += 3;
  }
  if (entry.grain === "ags") {
    score += 6;
  }

  for (const token of tokens) {
    if (entry.ags?.includes(token)) score += 25;
    if (entry.plz?.includes(token) || entry.plz8?.includes(token)) score += 25;
    if (foldedLabel.includes(token)) score += 10;
    if (foldedId.includes(token)) score += 8;
  }
  return score;
}

export function toSearchHit(entry: CatalogEntry): SearchHit {
  return {
    id: entry.id,
    label: entry.label,
    grain: entry.grain,
    lon: entry.lon,
    lat: entry.lat,
  };
}

/** Case- and umlaut-insensitive match across label, id, AGS, PLZ, and PLZ8. */
export function searchCatalog(query: string, limit = 12): SearchHit[] {
  const foldedQuery = fold(query);
  if (foldedQuery.length < 2) {
    return [];
  }
  const tokens = foldedQuery.split(/\s+/).filter(Boolean);
  const ranked: RankedHit[] = [];
  for (const entry of CATALOG) {
    const score = scoreEntry(entry, tokens, foldedQuery);
    if (score > 0) {
      ranked.push({ entry, score });
    }
  }
  ranked.sort(
    (a, b) =>
      b.score - a.score || a.entry.label.localeCompare(b.entry.label, "de"),
  );
  return ranked.slice(0, limit).map((item) => toSearchHit(item.entry));
}

function cellPolygon(col: number, row: number): Polygon {
  const lon = ORIGIN_LON + col * CELL_LON;
  const lat = ORIGIN_LAT + row * CELL_LAT;
  return {
    type: "Polygon",
    coordinates: [
      [
        [lon, lat],
        [lon + CELL_LON, lat],
        [lon + CELL_LON, lat + CELL_LAT],
        [lon, lat + CELL_LAT],
        [lon, lat],
      ],
    ],
  };
}

/** `GET /layers/grid100` — twelve ~100 m cells as a GeoJSON FeatureCollection. */
export function gridLayer(): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = GRID.map((cell, index) => {
    const col = index % COLS;
    const row = Math.floor(index / COLS);
    return {
      type: "Feature",
      id: cell.id,
      geometry: cellPolygon(col, row),
      properties: {
        id: cell.id,
        label: cell.label,
        grain: cell.grain,
        lon: cell.lon,
        lat: cell.lat,
      },
    };
  });
  return { type: "FeatureCollection", features };
}

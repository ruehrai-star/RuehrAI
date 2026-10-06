import { Client } from "pg";
import { buildPatternByDataset } from "../analysis/pattern-profile";
import { AnalysisRegion, PatternCriterion } from "../analysis/types";
import { YearlySeries } from "../analysis/yearly-series";
import {
  AreaCandidate,
  buildTeilCatalogSql,
  compareSpatialGeoKey,
  spatialMd5,
  spatialEvenHitsLimitSql,
  teilCatalogQuery,
} from "./area-candidates";
import { rankTeilflaechen } from "./score";

const POSTGIS_URL = process.env.POSTGIS_URL?.trim();
const describePg = POSTGIS_URL ? describe : describe.skip;
jest.setTimeout(60_000);

const TEMPELHOF: AnalysisRegion = {
  label: "Tempelhof",
  grain: "other",
  geoKey: "ortsteil:osm:162894",
  level: "ortsteil",
  parentLabel: "Berlin",
  ags: "11000000",
  plz: null,
  lon: 13.38,
  lat: 52.47,
  bounds: null,
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [13.35, 52.45],
        [13.42, 52.45],
        [13.42, 52.49],
        [13.35, 52.49],
        [13.35, 52.45],
      ],
    ],
  },
  updatedAt: "2026-10-06T00:00:00.000Z",
};

const LICHTERFELDE: AnalysisRegion = {
  label: "Lichterfelde",
  grain: "other",
  geoKey: "ortsteil:osm:55737",
  level: "ortsteil",
  parentLabel: "Berlin",
  ags: "11000000",
  plz: null,
  lon: 13.31,
  lat: 52.43,
  bounds: null,
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [13.28, 52.41],
        [13.35, 52.41],
        [13.35, 52.45],
        [13.28, 52.45],
        [13.28, 52.41],
      ],
    ],
  },
  updatedAt: "2026-10-06T00:00:00.000Z",
};

function box(west: number, south: number, east: number, north: number): string {
  return JSON.stringify({
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  });
}

const criterion: PatternCriterion = {
  key: "unfallatlas",
  metricId: "unfallatlas",
  label: "Unfälle",
  direction: "down",
  evidence: "fällt",
  kind: "trend",
  coverage: "multi",
  baseline: "per_1000_inhabitants",
};

describePg("PostGIS: Score-Rang Tempelhof / Lichterfelde und md5-Vorauswahl", () => {
  let client: Client;

  beforeAll(async () => {
    client = await connectPostgis(POSTGIS_URL!);
    await client.query("CREATE EXTENSION IF NOT EXISTS postgis");
    await client.query("CREATE SCHEMA IF NOT EXISTS geo");
    await client.query("CREATE SCHEMA IF NOT EXISTS features");
    await client.query(`
      DROP TABLE IF EXISTS geo.geo_ref_zielregion_teil;
      DROP TABLE IF EXISTS geo.geo_ref_lor;
      DROP TABLE IF EXISTS geo.geo_ref_ortsteil;
      DROP TABLE IF EXISTS geo.geo_ref_bezirk;
      DROP TABLE IF EXISTS geo.geo_ref_plz;
      DROP TABLE IF EXISTS geo.geo_ref_admin;
      DROP TABLE IF EXISTS features.location_feature_docs;
      CREATE TABLE geo.geo_ref_lor (
        geo_lor_id text PRIMARY KEY,
        name text,
        geo_ags text,
        geo_bezirk_id text,
        lor_level text,
        valid_to date,
        geom geometry(Geometry, 4326)
      );
      CREATE TABLE geo.geo_ref_ortsteil (
        geo_ortsteil_id text,
        kind text,
        name text,
        geo_ags text,
        geom geometry(Geometry, 4326)
      );
      CREATE TABLE geo.geo_ref_bezirk (
        geo_bezirk_id text,
        name text,
        geo_ags text,
        geom geometry(Geometry, 4326)
      );
      CREATE TABLE geo.geo_ref_plz (
        geo_plz5 text,
        geo_ags text,
        geom geometry(Geometry, 4326)
      );
      CREATE TABLE geo.geo_ref_admin (
        geo_ags text,
        name text,
        geom geometry(Geometry, 3035),
        geom_4326 geometry(Geometry, 4326),
        geom_display geometry(Geometry, 4326)
      );
      CREATE TABLE geo.geo_ref_zielregion_teil (
        parent_grain text,
        parent_id text,
        child_grain text,
        child_id text
      );
      CREATE TABLE features.location_feature_docs (
        geo_key text,
        source_theme text,
        title text,
        metadata jsonb,
        lon float8,
        lat float8,
        ref_period date
      );
    `);
    await client.query(
      `INSERT INTO geo.geo_ref_lor (geo_lor_id, name, geo_ags, geo_bezirk_id, lor_level, valid_to, geom) VALUES
        ('07400720', 'Germaniagarten', '11000000', '11000007', 'planungsraum', NULL, ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)),
        ('07400721', 'Tempelhof-Nord', '11000000', '11000007', 'planungsraum', NULL, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)),
        ('07400722', 'Tempelhof-Süd', '11000000', '11000007', 'planungsraum', NULL, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)),
        ('07400723', 'Marienhöhe', '11000000', '11000007', 'planungsraum', NULL, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)),
        ('06200420', 'Lichterfelde-Ost', '11000000', '11000006', 'planungsraum', NULL, ST_SetSRID(ST_GeomFromGeoJSON($5), 4326)),
        ('06200421', 'Lichterfelde-West', '11000000', '11000006', 'planungsraum', NULL, ST_SetSRID(ST_GeomFromGeoJSON($6), 4326)),
        ('06200422', 'Botanischer Garten', '11000000', '11000006', 'planungsraum', NULL, ST_SetSRID(ST_GeomFromGeoJSON($7), 4326)),
        ('06200423', 'Lichterfelde-Süd', '11000000', '11000006', 'planungsraum', NULL, ST_SetSRID(ST_GeomFromGeoJSON($8), 4326))`,
      [
        box(13.36, 52.46, 13.38, 52.475),
        box(13.38, 52.46, 13.40, 52.475),
        box(13.36, 52.475, 13.38, 52.485),
        box(13.38, 52.475, 13.40, 52.485),
        box(13.29, 52.42, 13.31, 52.43),
        box(13.31, 52.42, 13.33, 52.43),
        box(13.29, 52.43, 13.31, 52.44),
        box(13.31, 52.43, 13.33, 52.44),
      ],
    );
    await client.query(`
      INSERT INTO geo.geo_ref_zielregion_teil (parent_grain, parent_id, child_grain, child_id) VALUES
        ('ortsteil', 'ortsteil:osm:162894', 'lor_plr', 'lor:plr:07400720'),
        ('ortsteil', 'ortsteil:osm:162894', 'lor_plr', 'lor:plr:07400721'),
        ('ortsteil', 'ortsteil:osm:162894', 'lor_plr', 'lor:plr:07400722'),
        ('ortsteil', 'ortsteil:osm:162894', 'lor_plr', 'lor:plr:07400723'),
        ('ortsteil', 'ortsteil:osm:55737', 'lor_plr', 'lor:plr:06200420'),
        ('ortsteil', 'ortsteil:osm:55737', 'lor_plr', 'lor:plr:06200421'),
        ('ortsteil', 'ortsteil:osm:55737', 'lor_plr', 'lor:plr:06200422'),
        ('ortsteil', 'ortsteil:osm:55737', 'lor_plr', 'lor:plr:06200423')
    `);
  }, 60_000);

  afterAll(async () => {
    await client?.end().catch(() => undefined);
  });

  it("orders more than one cell by md5(geo_key), matching Node md5, not alphabetically", async () => {
    const keys = ["zzz:last", "aaa:first", "lor:plr:07400720", "lor:plr:06200420"];
    const sqlOrder = await client.query<{ geo_key: string }>(
      `SELECT geo_key FROM unnest($1::text[]) AS t(geo_key) ORDER BY md5(geo_key), geo_key`,
      [keys],
    );
    const nodeOrder = [...keys].sort(compareSpatialGeoKey);
    expect(sqlOrder.rows.map((row) => row.geo_key)).toEqual(nodeOrder);
    expect(nodeOrder).not.toEqual([...keys].sort((left, right) => left.localeCompare(right)));
    expect(spatialEvenHitsLimitSql()).toContain("md5(");
    expect(spatialMd5(keys[0]!)).toHaveLength(32);
  });

  it("ranks Tempelhof and Lichterfelde with unequal, evidence-backed scores", async () => {
    const tempelhofQuery = teilCatalogQuery(TEMPELHOF);
    expect(tempelhofQuery.sql).toBe(buildTeilCatalogSql("prefer"));
    const tempelhofRows = await client.query<{
      geo_key: string;
      kind: string;
      name: string | null;
      grain: string;
    }>(tempelhofQuery.sql, tempelhofQuery.params);
    const lichterfeldeRows = await client.query<{
      geo_key: string;
      kind: string;
      name: string | null;
      grain: string;
    }>(teilCatalogQuery(LICHTERFELDE).sql, teilCatalogQuery(LICHTERFELDE).params);

    const tempelhofHits = tempelhofRows.rows.filter((row) => row.kind === "lor");
    const lichterfeldeHits = lichterfeldeRows.rows.filter((row) => row.kind === "lor");
    expect(tempelhofHits.length).toBeGreaterThanOrEqual(4);
    expect(lichterfeldeHits.length).toBeGreaterThanOrEqual(4);

    const values: Record<string, [number, number]> = {
      "lor:plr:07400720": [20, 8],
      "lor:plr:07400721": [16, 12],
      "lor:plr:07400722": [10, 18],
      "lor:plr:07400723": [6, 24],
      "lor:plr:06200420": [19, 9],
      "lor:plr:06200421": [14, 14],
      "lor:plr:06200422": [8, 22],
      "lor:plr:06200423": [4, 28],
    };

    const toCandidate = (row: { geo_key: string; kind: string; name: string | null; grain: string }, regionKey: string): AreaCandidate => ({
      id: `${row.grain}:${row.geo_key}@${regionKey}`,
      geoKey: row.geo_key,
      grain: row.grain === "plz5" ? "plz5" : "other",
      kind: "lor",
      title: row.name ?? row.geo_key,
      name: row.name,
      ags: "11000000",
      plz: null,
      lon: null,
      lat: null,
      targetRegionGeoKey: regionKey,
    });

    const seriesFor = (geoKey: string): YearlySeries[] => {
      const pair = values[geoKey] ?? [10, 12];
      return [
        {
          metricId: "unfallatlas",
          requestedLevel: "lor",
          requestedGeoKey: geoKey,
          sourceLevel: "lor",
          sourceGeoKey: geoKey,
          granularity: "year",
          coverage: "multi",
          points: [
            { period: "2023", status: "present", value: pair[0] },
            { period: "2025", status: "present", value: pair[1] },
          ],
        },
        {
          metricId: "bevoelkerung",
          requestedLevel: "lor",
          requestedGeoKey: geoKey,
          sourceLevel: "lor",
          sourceGeoKey: geoKey,
          granularity: "year",
          coverage: "multi",
          points: [
            { period: "2023", status: "present", value: 10_000 },
            { period: "2025", status: "present", value: 10_000 },
          ],
        },
      ];
    };

    const patternByDataset = buildPatternByDataset(seriesFor("lor:plr:07400720"));
    const tempelhofRanked = rankTeilflaechen(
      tempelhofHits.map((row) => toCandidate(row, TEMPELHOF.geoKey!)),
      tempelhofHits.flatMap((row) => seriesFor(row.geo_key)),
      [criterion],
      [TEMPELHOF],
      { patternByDataset },
    );
    const lichterfeldeRanked = rankTeilflaechen(
      lichterfeldeHits.map((row) => toCandidate(row, LICHTERFELDE.geoKey!)),
      lichterfeldeHits.flatMap((row) => seriesFor(row.geo_key)),
      [criterion],
      [LICHTERFELDE],
      { patternByDataset },
    );

    expect(new Set(tempelhofRanked.map((item) => item.score)).size).toBeGreaterThan(1);
    expect(new Set(lichterfeldeRanked.map((item) => item.score)).size).toBeGreaterThan(1);
    expect(tempelhofRanked[0]?.name).toBe("Germaniagarten");
    expect(tempelhofRanked[0]?.criteriaEvidence[0]?.proximity).toBeGreaterThan(
      tempelhofRanked[tempelhofRanked.length - 1]?.criteriaEvidence[0]?.proximity ?? -1,
    );
    expect(lichterfeldeRanked[0]?.name).toBe("Lichterfelde-Ost");
    expect(tempelhofRanked.every((item) => (item.trend?.summary ?? "").includes("lor:plr:") === false)).toBe(true);
    expect(JSON.stringify(tempelhofRanked.map((item) => item.criteriaEvidence[0]?.evidence))).not.toMatch(/lor:plr:/);
  });
});

async function connectPostgis(url: string): Promise<Client> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("PostGIS unavailable");
}

import { Injectable, Logger } from "@nestjs/common";
import { sourceThemesForTopics } from "../address-pair/topics";
import { DatabaseService } from "../database/database.service";
import {
  isFeaturesAccessDenied,
  isGeoCatalogUnavailable,
  isMissingFeaturesRelation,
} from "../database/pg-error";
import { officialAgsKey } from "../geo/geo-catalog";
import {
  RegionSourceKeys,
  SERIES_METRICS,
  SeriesFeatureRow,
  SeriesRegionInput,
  YearlySeries,
  buildMetricSeries,
  keysForResolvedPlace,
  municipalityAgsFrom,
  parentsFromGemeinde,
  requestedGeoKeyOf,
  requestedLevelOf,
} from "./yearly-series";

interface PlzRow {
  plz: string | null;
  geo_ags: string | null;
  geo_ags5: string | null;
  geo_land: string | null;
}

interface OrtsteilRow {
  id: string | null;
  geo_key: string | null;
  geo_ags: string | null;
}

interface BezirkRow {
  id: string | null;
  geo_ags: string | null;
}

@Injectable()
export class YearlySeriesService {
  private readonly logger = new Logger(YearlySeriesService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Stored Brain values for the last three years on each Zielregion.
   * Never interpolates. Store revenue is not included.
   */
  async build(regions: SeriesRegionInput[], asOf = new Date()): Promise<YearlySeries[]> {
    const resolved = await this.resolveRegions(regions);
    if (resolved.length === 0) return [];
    const docs = await this.readFeatureDocs(allLookupKeys(resolved));
    return resolved.flatMap((region) =>
      SERIES_METRICS.map((metric) =>
        buildMetricSeries({
          metricId: metric.id,
          homeLevel: metric.homeLevel,
          region,
          docs,
          asOf,
        }),
      ),
    );
  }

  private async resolveRegions(regions: SeriesRegionInput[]): Promise<RegionSourceKeys[]> {
    const wanted = regions
      .map((region) => {
        const requestedLevel = requestedLevelOf(region);
        const requestedGeoKey = requestedGeoKeyOf(region);
        if (!requestedLevel || !requestedGeoKey) return null;
        return { region, requestedLevel, requestedGeoKey };
      })
      .filter((item): item is { region: SeriesRegionInput; requestedLevel: NonNullable<ReturnType<typeof requestedLevelOf>>; requestedGeoKey: string } =>
        item !== null,
      );

    const needPlz = wanted
      .filter((item) => item.requestedLevel === "plz" && !municipalityAgsFrom(item.region))
      .map((item) => item.region.plz ?? item.requestedGeoKey.replace(/^(?:plz5|plz8):/i, ""));
    const needOrtsteil = wanted
      .filter(
        (item) =>
          (item.requestedLevel === "stadtteil" || item.requestedLevel === "ortsteil") &&
          !municipalityAgsFrom(item.region),
      )
      .flatMap((item) => ortsteilLookupIds(item.requestedGeoKey));
    const needBezirk = wanted
      .filter(
        (item) =>
          (item.requestedLevel === "bezirk" || item.requestedLevel === "stadtbezirk") &&
          !municipalityAgsFrom(item.region),
      )
      .map((item) => bezirkLookupId(item.requestedGeoKey))
      .filter((id): id is string => Boolean(id));

    const plzRows = await this.readPlz(unique(needPlz));
    const ortsteilRows = await this.readOrtsteil(unique(needOrtsteil));
    const bezirkRows = await this.readBezirk(unique(needBezirk));

    return wanted.map((item) => resolveOne(item, plzRows, ortsteilRows, bezirkRows));
  }

  private async readPlz(postalCodes: string[]): Promise<PlzRow[]> {
    if (postalCodes.length === 0) return [];
    return this.readCatalog<PlzRow>(
      `SELECT geo_plz5::text AS plz,
              NULLIF(btrim(geo_ags::text), '') AS geo_ags,
              NULLIF(btrim(geo_ags5::text), '') AS geo_ags5,
              NULLIF(btrim(geo_land::text), '') AS geo_land
         FROM geo.geo_ref_plz
        WHERE geo_plz5::text = ANY($1::text[])`,
      [postalCodes],
    );
  }

  private async readOrtsteil(ids: string[]): Promise<OrtsteilRow[]> {
    if (ids.length === 0) return [];
    return this.readCatalog<OrtsteilRow>(
      `SELECT geo_ortsteil_id::text AS id,
              (lower(btrim(kind)) || ':' || geo_ortsteil_id::text) AS geo_key,
              NULLIF(btrim(geo_ags::text), '') AS geo_ags
         FROM geo.geo_ref_ortsteil
        WHERE geo_ortsteil_id::text = ANY($1::text[])
           OR (lower(btrim(kind)) || ':' || geo_ortsteil_id::text) = ANY($1::text[])`,
      [ids],
    );
  }

  private async readBezirk(ids: string[]): Promise<BezirkRow[]> {
    if (ids.length === 0) return [];
    return this.readCatalog<BezirkRow>(
      `SELECT geo_bezirk_id::text AS id,
              NULLIF(btrim(geo_ags::text), '') AS geo_ags
         FROM geo.geo_ref_bezirk
        WHERE geo_bezirk_id::text = ANY($1::text[])`,
      [ids],
    );
  }

  private async readFeatureDocs(keys: string[]): Promise<SeriesFeatureRow[]> {
    if (keys.length === 0) return [];
    const themes = sourceThemesForTopics();
    const sql = `SELECT source_theme,
                        grain,
                        geo_key,
                        metadata,
                        ref_period
                   FROM features.location_feature_docs
                  WHERE source_theme = ANY($1::text[])
                    AND (
                      geo_key = ANY($2::text[])
                      OR metadata->>'geo_ags' = ANY($2::text[])
                      OR metadata->>'geo_ags5' = ANY($2::text[])
                      OR metadata->>'geo_land' = ANY($2::text[])
                    )`;
    try {
      const result = await this.db.queryReadingFeatures<SeriesFeatureRow>(sql, [themes, keys]);
      return result.rows;
    } catch (error) {
      if (isMissingFeaturesRelation(error) && /location_feature_docs/i.test(messageOf(error))) {
        return this.readFeatureView(themes, keys);
      }
      if (isCatalogMiss(error)) {
        this.noteCatalogMiss(error);
        return [];
      }
      throw error;
    }
  }

  private async readFeatureView(themes: string[], keys: string[]): Promise<SeriesFeatureRow[]> {
    const sql = `SELECT source_theme,
                        grain,
                        geo_key,
                        metadata,
                        ref_period
                   FROM features.v_location_search
                  WHERE source_theme = ANY($1::text[])
                    AND (
                      geo_key = ANY($2::text[])
                      OR metadata->>'geo_ags' = ANY($2::text[])
                      OR metadata->>'geo_ags5' = ANY($2::text[])
                      OR metadata->>'geo_land' = ANY($2::text[])
                    )`;
    try {
      const result = await this.db.queryReadingFeatures<SeriesFeatureRow>(sql, [themes, keys]);
      return result.rows;
    } catch (error) {
      if (isCatalogMiss(error)) {
        this.noteCatalogMiss(error);
        return [];
      }
      throw error;
    }
  }

  private async readCatalog<T extends object>(sql: string, params: unknown[]): Promise<T[]> {
    try {
      const result = await this.db.queryReadingFeatures<T>(sql, params);
      return result.rows;
    } catch (error) {
      if (isCatalogMiss(error)) {
        this.noteCatalogMiss(error);
        return [];
      }
      throw error;
    }
  }

  private noteCatalogMiss(error: unknown): void {
    this.logger.log(`Yearly-series catalog read missed (${messageOf(error)}).`);
  }
}

function resolveOne(
  item: { region: SeriesRegionInput; requestedLevel: NonNullable<ReturnType<typeof requestedLevelOf>>; requestedGeoKey: string },
  plzRows: PlzRow[],
  ortsteilRows: OrtsteilRow[],
  bezirkRows: BezirkRow[],
): RegionSourceKeys {
  const fromRegion = municipalityAgsFrom(item.region);
  const fromCatalog = gemeindeFromCatalog(item, plzRows, ortsteilRows, bezirkRows);
  const gemeindeAgs = fromRegion ?? fromCatalog.gemeinde;
  const kreisAgs = fromCatalog.kreis ?? (gemeindeAgs ? parentsFromGemeinde(gemeindeAgs).kreis : null);
  const landAgs = fromCatalog.land ?? (gemeindeAgs ? parentsFromGemeinde(gemeindeAgs).land : null);
  return keysForResolvedPlace(item.requestedLevel, item.requestedGeoKey, gemeindeAgs, kreisAgs, landAgs);
}

function gemeindeFromCatalog(
  item: { region: SeriesRegionInput; requestedLevel: NonNullable<ReturnType<typeof requestedLevelOf>>; requestedGeoKey: string },
  plzRows: PlzRow[],
  ortsteilRows: OrtsteilRow[],
  bezirkRows: BezirkRow[],
): { gemeinde: string | null; kreis: string | null; land: string | null } {
  if (item.requestedLevel === "plz") {
    const plz = item.region.plz ?? item.requestedGeoKey.replace(/^(?:plz5|plz8):/i, "");
    const rows = plzRows.filter((row) => row.plz === plz);
    const municipalities = unique(rows.map((row) => normalizeAgs(row.geo_ags, 8)));
    const districts = unique(rows.map((row) => normalizeAgs(row.geo_ags5, 5)));
    const lands = unique(rows.map((row) => normalizeAgs(row.geo_land, 2)));
    if (municipalities.length !== 1 || districts.length !== 1) {
      return { gemeinde: null, kreis: null, land: null };
    }
    return {
      gemeinde: municipalities[0]!,
      kreis: districts[0]!,
      land: lands.length === 1 ? lands[0]! : null,
    };
  }

  if (item.requestedLevel === "stadtteil" || item.requestedLevel === "ortsteil") {
    const ids = new Set(ortsteilLookupIds(item.requestedGeoKey));
    const rows = ortsteilRows.filter(
      (row) => (row.id && ids.has(row.id)) || (row.geo_key && ids.has(row.geo_key)),
    );
    const municipalities = unique(rows.map((row) => normalizeAgs(row.geo_ags, 8)));
    if (municipalities.length !== 1) return { gemeinde: null, kreis: null, land: null };
    const parents = parentsFromGemeinde(municipalities[0]!);
    return { gemeinde: municipalities[0]!, kreis: parents.kreis, land: parents.land };
  }

  if (item.requestedLevel === "bezirk" || item.requestedLevel === "stadtbezirk") {
    const id = bezirkLookupId(item.requestedGeoKey);
    const rows = bezirkRows.filter((row) => row.id === id);
    const fromTable = unique(rows.map((row) => normalizeAgs(row.geo_ags, 8)));
    if (fromTable.length === 1) {
      const parents = parentsFromGemeinde(fromTable[0]!);
      return { gemeinde: fromTable[0]!, kreis: parents.kreis, land: parents.land };
    }
  }

  return { gemeinde: null, kreis: null, land: null };
}

function ortsteilLookupIds(geoKey: string): string[] {
  const ids = [geoKey];
  const match = /^(stadtteil|ortsteil):(.+)$/i.exec(geoKey.trim());
  if (match?.[2]) ids.push(match[2]);
  return unique(ids);
}

function bezirkLookupId(geoKey: string): string | null {
  const stripped = geoKey.replace(/^(?:ags|stadtbezirk|bezirk):/i, "").trim();
  return officialAgsKey(geoKey) ?? (stripped || null);
}

function allLookupKeys(regions: RegionSourceKeys[]): string[] {
  return unique(regions.flatMap((region) => [...region.requested, ...region.gemeinde, ...region.kreis, ...region.land]));
}

function normalizeAgs(value: string | null | undefined, width: number): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (!/^[0-9]+$/.test(raw) || raw.length > width) return null;
  return raw.length >= width ? raw : raw.padStart(width, "0");
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function isCatalogMiss(error: unknown): boolean {
  return isGeoCatalogUnavailable(error) || isMissingFeaturesRelation(error) || isFeaturesAccessDenied(error);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

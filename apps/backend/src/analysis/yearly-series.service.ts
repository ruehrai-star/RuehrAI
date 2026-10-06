import { Injectable, Logger } from "@nestjs/common";
import { sourceThemesForSeries } from "../address-pair/topics";
import { DatabaseService, featuresReadQuery } from "../database/database.service";
import {
  isFeaturesAccessDenied,
  isGeoCatalogUnavailable,
  isMissingFeaturesRelation,
} from "../database/pg-error";
import { officialAgsKey } from "../geo/geo-catalog";
import { canonicalBerlinBezirkAgs, isOfficialBerlinBezirkAgs } from "../geo/bezirk-ags";
import { AreaBaselineService } from "./area-baseline.service";
import { runComputeJob } from "./compute-host";
import { throwIfAborted } from "./run-abort";
import {
  RegionSourceKeys,
  SeriesFeatureRow,
  SeriesRegionInput,
  YearlySeries,
  keysForResolvedPlace,
  kreisAgsFrom,
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
  geo_bezirk_id: string | null;
}

interface BezirkRow {
  id: string | null;
  geo_ags: string | null;
}

@Injectable()
export class YearlySeriesService {
  private readonly logger = new Logger(YearlySeriesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly areaBaseline: AreaBaselineService,
  ) {}

  /**
   * Stored Brain values for the last three years on each Zielregion.
   * Never interpolates. Store revenue is not included. Catalog-listed
   * themes are baselined from `geo.area_baseline` (method on each point).
   */
  async build(
    regions: SeriesRegionInput[],
    asOf = new Date(),
    signal?: AbortSignal,
  ): Promise<YearlySeries[]> {
    throwIfAborted(signal);
    const resolved = await this.resolveRegions(regions);
    throwIfAborted(signal);
    if (resolved.length === 0) return [];
    const docs = await this.readFeatureDocs(allLookupKeys(resolved));
    throwIfAborted(signal);
    const computed = await runComputeJob(
      {
        type: "yearlySeries",
        resolved,
        docs,
        asOfIso: asOf.toISOString(),
        catalog: [],
        rows: [],
      },
      signal,
    );
    if (computed.type !== "yearlySeries") {
      throw new Error(`YearlySeries worker returned ${computed.type}`);
    }
    this.logger.log(
      `YearlySeries build regions=${resolved.length} docs=${docs.length} chunks=${computed.stats.chunks} maxSyncMs=${computed.stats.maxSyncMs}`,
    );
    throwIfAborted(signal);
    return this.areaBaseline.normalize(computed.series);
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
          item.requestedLevel === "stadtteil" ||
          item.requestedLevel === "ortsteil" ||
          /^hamburg_stadtteil:/i.test(item.requestedGeoKey),
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
    const rows = await this.readCatalog<OrtsteilRow>(
      `SELECT geo_ortsteil_id::text AS id,
              (lower(btrim(kind)) || ':' || geo_ortsteil_id::text) AS geo_key,
              NULLIF(btrim(geo_ags::text), '') AS geo_ags,
              NULL::text AS geo_bezirk_id
         FROM geo.geo_ref_ortsteil
        WHERE geo_ortsteil_id::text = ANY($1::text[])
           OR (lower(btrim(kind)) || ':' || geo_ortsteil_id::text) = ANY($1::text[])`,
      [ids],
    );
    const bezirke = await this.readOrtsteilBezirk(ids);
    return rows.map((row) => {
      const match = bezirke.find(
        (item) => item.id === row.id || item.geo_key === row.geo_key,
      );
      return match?.geo_bezirk_id ? { ...row, geo_bezirk_id: match.geo_bezirk_id } : row;
    });
  }

  private async readOrtsteilBezirk(ids: string[]): Promise<OrtsteilRow[]> {
    if (ids.length === 0) return [];
    try {
      return await this.readCatalog<OrtsteilRow>(
        `SELECT o.geo_ortsteil_id::text AS id,
                (lower(btrim(o.kind)) || ':' || o.geo_ortsteil_id::text) AS geo_key,
                NULLIF(btrim(o.geo_ags::text), '') AS geo_ags,
                NULLIF(btrim(b.geo_bezirk_id::text), '') AS geo_bezirk_id
           FROM geo.geo_ref_ortsteil o
           JOIN geo.geo_ref_bezirk b
             ON o.geom IS NOT NULL AND NOT ST_IsEmpty(o.geom)
            AND b.geom IS NOT NULL AND NOT ST_IsEmpty(b.geom)
            AND ST_Intersects(b.geom, ST_PointOnSurface(o.geom))
          WHERE o.geo_ortsteil_id::text = ANY($1::text[])
             OR (lower(btrim(o.kind)) || ':' || o.geo_ortsteil_id::text) = ANY($1::text[])`,
        [ids],
      );
    } catch (error) {
      this.noteCatalogMiss(error);
      return [];
    }
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
    const themes = sourceThemesForSeries();
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
      const result = await featuresReadQuery(this.db)<SeriesFeatureRow>(sql, [themes, keys]);
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
      const result = await featuresReadQuery(this.db)<SeriesFeatureRow>(sql, [themes, keys]);
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
      const result = await featuresReadQuery(this.db)<T>(sql, params);
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
  const kreisAgs =
    fromCatalog.kreis ??
    (gemeindeAgs ? parentsFromGemeinde(gemeindeAgs).kreis : null) ??
    (item.requestedLevel === "kreis" ? kreisAgsFrom(item.region) : null);
  const landAgs =
    fromCatalog.land ??
    (gemeindeAgs ? parentsFromGemeinde(gemeindeAgs).land : null) ??
    (kreisAgs ? parentsFromGemeinde(kreisAgs).land : null);
  const bezirkOfficial = berlinBezirkOfficial(item, fromCatalog.bezirk, bezirkRows);
  const plz = item.requestedLevel === "plz" ? item.region.plz ?? item.requestedGeoKey.replace(/^(?:plz5|plz8):/i, "") : null;
  return keysForResolvedPlace(item.requestedLevel, item.requestedGeoKey, gemeindeAgs, kreisAgs, landAgs, {
    bezirkOfficial,
    plz,
  });
}

function gemeindeFromCatalog(
  item: { region: SeriesRegionInput; requestedLevel: NonNullable<ReturnType<typeof requestedLevelOf>>; requestedGeoKey: string },
  plzRows: PlzRow[],
  ortsteilRows: OrtsteilRow[],
  bezirkRows: BezirkRow[],
): { gemeinde: string | null; kreis: string | null; land: string | null; bezirk: string | null } {
  if (item.requestedLevel === "plz") {
    const plz = item.region.plz ?? item.requestedGeoKey.replace(/^(?:plz5|plz8):/i, "");
    const rows = plzRows.filter((row) => row.plz === plz);
    const municipalities = unique(rows.map((row) => normalizeAgs(row.geo_ags, 8)));
    const districts = unique(rows.map((row) => normalizeAgs(row.geo_ags5, 5)));
    const lands = unique(rows.map((row) => normalizeAgs(row.geo_land, 2)));
    if (municipalities.length !== 1 || districts.length !== 1) {
      return { gemeinde: null, kreis: null, land: null, bezirk: null };
    }
    return {
      gemeinde: municipalities[0]!,
      kreis: districts[0]!,
      land: lands.length === 1 ? lands[0]! : null,
      bezirk: null,
    };
  }

  if (item.requestedLevel === "stadtteil" || item.requestedLevel === "ortsteil") {
    const ids = new Set(ortsteilLookupIds(item.requestedGeoKey));
    const rows = ortsteilRows.filter(
      (row) => (row.id && ids.has(row.id)) || (row.geo_key && ids.has(row.geo_key)),
    );
    const municipalities = unique(rows.map((row) => normalizeAgs(row.geo_ags, 8)));
    const bezirke = unique(rows.map((row) => berlinOfficialBezirkId(row.geo_bezirk_id)));
    if (municipalities.length !== 1) return { gemeinde: null, kreis: null, land: null, bezirk: bezirke.length === 1 ? bezirke[0]! : null };
    const parents = parentsFromGemeinde(municipalities[0]!);
    return {
      gemeinde: municipalities[0]!,
      kreis: parents.kreis,
      land: parents.land,
      bezirk: bezirke.length === 1 ? bezirke[0]! : null,
    };
  }

  if (item.requestedLevel === "bezirk" || item.requestedLevel === "stadtbezirk") {
    const id = bezirkLookupId(item.requestedGeoKey);
    const rows = bezirkRows.filter((row) => row.id === id);
    const fromTable = unique(rows.map((row) => normalizeAgs(row.geo_ags, 8)));
    const official = berlinOfficialBezirkId(id);
    if (fromTable.length === 1) {
      const parents = parentsFromGemeinde(fromTable[0]!);
      return { gemeinde: fromTable[0]!, kreis: parents.kreis, land: parents.land, bezirk: official };
    }
    if (official) {
      return { gemeinde: null, kreis: null, land: null, bezirk: official };
    }
  }

  return { gemeinde: null, kreis: null, land: null, bezirk: null };
}

function ortsteilLookupIds(geoKey: string): string[] {
  const ids = [geoKey];
  const match = /^(stadtteil|ortsteil|hamburg_stadtteil):(.+)$/i.exec(geoKey.trim());
  if (match?.[2]) {
    ids.push(match[2], `ortsteil:${match[2]}`, `stadtteil:${match[2]}`, `hamburg_stadtteil:${match[2]}`);
  }
  return unique(ids);
}

function bezirkLookupId(geoKey: string): string | null {
  const stripped = geoKey.replace(/^(?:ags|stadtbezirk|bezirk):/i, "").trim();
  return officialAgsKey(geoKey) ?? (stripped || null);
}

function allLookupKeys(regions: RegionSourceKeys[]): string[] {
  return unique(
    regions.flatMap((region) => [
      ...region.requested,
      ...region.bezirk,
      region.bezirkRsKey,
      ...region.plz,
      ...region.gemeinde,
      ...region.kreis,
      ...region.land,
    ]),
  );
}

function berlinBezirkOfficial(
  item: { region: SeriesRegionInput; requestedLevel: NonNullable<ReturnType<typeof requestedLevelOf>>; requestedGeoKey: string },
  fromCatalog: string | null,
  bezirkRows: BezirkRow[],
): string | null {
  if (fromCatalog) return fromCatalog;
  const fromKey = berlinOfficialBezirkId(item.requestedGeoKey) ?? berlinOfficialBezirkId(item.region.ags);
  if (fromKey) return fromKey;
  const id = bezirkLookupId(item.requestedGeoKey);
  const row = bezirkRows.find((itemRow) => itemRow.id === id);
  return berlinOfficialBezirkId(row?.id ?? null);
}

function berlinOfficialBezirkId(value: string | null | undefined): string | null {
  if (!value) return null;
  const stripped = value.replace(/^(?:ags|stadtbezirk|bezirk):/i, "").trim();
  const official = canonicalBerlinBezirkAgs(stripped);
  return isOfficialBerlinBezirkAgs(official) ? official : null;
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

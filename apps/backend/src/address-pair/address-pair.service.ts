import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  isFeaturesAccessDenied,
  isGeoCatalogUnavailable,
  isMissingFeaturesRelation,
} from "../database/pg-error";
import { AddressInputDto, AddressPairRequestDto } from "./dto";
import {
  FIXED_TOPICS,
  TopicId,
  TopicLevel,
  grainMatchesTopic,
  sourceThemesForTopics,
  themeMatchesTopic,
} from "./topics";
import { storedRowValue, zensus2022Value } from "./value";

export interface AddressInput {
  street: string;
  postalCode: string;
  city: string;
}

export interface PlaceName {
  name: string;
}

export interface AddressTopic {
  id: string;
  level: TopicLevel;
  status: "present" | "absent";
  value?: unknown;
}

export interface AddressSide {
  input: AddressInput;
  resolution: "resolved" | "unknown";
  gemeinde: PlaceName | null;
  kreis: PlaceName | null;
  land: PlaceName | null;
  topics: AddressTopic[];
}

export interface SharedTopic {
  id: string;
  level: TopicLevel;
  left: unknown;
  right: unknown;
}

export interface AddressPairResult {
  left: AddressSide;
  right: AddressSide;
  shared: SharedTopic[];
}

interface PlzRow {
  plz: string | null;
  geo_ags: string | null;
  geo_ags5: string | null;
  geo_land: string | null;
}

interface AdminRow {
  geo_ags: string | null;
  name: string | null;
}

interface FeatureRow {
  source_theme: string | null;
  grain: string | null;
  geo_key: string | null;
  metadata: unknown;
  ref_period: string | null;
}

interface PlaceKeys {
  gemeinde: string[];
  kreis: string[];
  land: string[];
}

interface ResolvedPlace {
  gemeinde: PlaceName;
  kreis: PlaceName;
  land: PlaceName | null;
  keys: PlaceKeys;
}

@Injectable()
export class AddressPairService {
  private readonly logger = new Logger(AddressPairService.name);

  constructor(private readonly db: DatabaseService) {}

  async evaluate(dto: AddressPairRequestDto): Promise<AddressPairResult> {
    const leftInput = echoInput(dto.left);
    const rightInput = echoInput(dto.right);
    const postalCodes = unique([leftInput.postalCode, rightInput.postalCode]);

    const plzRows = await this.readPlz(postalCodes);
    const adminKeys = unique(
      plzRows.flatMap((row) => [normalizeAgs(row.geo_ags, 8), normalizeAgs(row.geo_ags5, 5), normalizeAgs(row.geo_land, 2)]),
    );
    const adminNames = await this.readAdminNames(adminKeys);

    const resolved = new Map<string, ResolvedPlace | null>();
    for (const plz of postalCodes) {
      resolved.set(plz, resolvePlace(plzRows.filter((row) => row.plz === plz), adminNames));
    }

    const places = [...resolved.values()].filter((place): place is ResolvedPlace => place !== null);
    const docs = places.length === 0 ? [] : await this.readFeatureDocs(allLookupKeys(places));
    const left = this.buildSide(leftInput, resolved.get(leftInput.postalCode) ?? null, docs);
    const right = this.buildSide(rightInput, resolved.get(rightInput.postalCode) ?? null, docs);

    return { left, right, shared: sharedFrom(left, right) };
  }

  private buildSide(input: AddressInput, place: ResolvedPlace | null, docs: FeatureRow[]): AddressSide {
    if (!place) {
      return {
        input,
        resolution: "unknown",
        gemeinde: null,
        kreis: null,
        land: null,
        topics: [],
      };
    }

    const topics = FIXED_TOPICS.map(({ id, level }) => topicFromDocs(id, level, place.keys[level], docs));
    return {
      input,
      resolution: "resolved",
      gemeinde: place.gemeinde,
      kreis: place.kreis,
      land: place.land,
      topics,
    };
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

  private async readAdminNames(keys: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    if (keys.length === 0) return names;
    const rows = await this.readCatalog<AdminRow>(
      `SELECT geo_ags::text AS geo_ags, NULLIF(btrim(name), '') AS name
         FROM geo.geo_ref_admin
        WHERE geo_ags::text = ANY($1::text[])`,
      [keys],
    );
    for (const row of rows) {
      const key = digits(row.geo_ags);
      const name = row.name?.trim();
      if (!key || !name) continue;
      names.set(key, name);
      names.set(padDigits(key, key.length <= 2 ? 2 : key.length <= 5 ? 5 : 8), name);
    }
    return names;
  }

  private async readFeatureDocs(keys: string[]): Promise<FeatureRow[]> {
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
      const result = await this.db.queryReadingFeatures<FeatureRow>(sql, [themes, keys]);
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

  private async readFeatureView(themes: string[], keys: string[]): Promise<FeatureRow[]> {
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
      const result = await this.db.queryReadingFeatures<FeatureRow>(sql, [themes, keys]);
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
    this.logger.log(`Address-pair catalog read missed (${messageOf(error)}).`);
  }
}

export function echoInput(input: AddressInputDto): AddressInput {
  return {
    street: input.street,
    postalCode: input.postalCode,
    city: input.city,
  };
}

export function sharedFrom(left: AddressSide, right: AddressSide): SharedTopic[] {
  if (left.resolution !== "resolved" || right.resolution !== "resolved") return [];
  const rightPresent = presentIndex(right);
  const shared: SharedTopic[] = [];
  for (const topic of left.topics) {
    if (topic.status !== "present") continue;
    const other = rightPresent.get(`${topic.level}:${topic.id}`);
    if (!other) continue;
    shared.push({ id: topic.id, level: topic.level, left: topic.value, right: other.value });
  }
  return shared;
}

function presentIndex(side: AddressSide): Map<string, AddressTopic> {
  const map = new Map<string, AddressTopic>();
  for (const topic of side.topics) {
    if (topic.status !== "present") continue;
    map.set(`${topic.level}:${topic.id}`, topic);
  }
  return map;
}

function resolvePlace(rows: PlzRow[], adminNames: Map<string, string>): ResolvedPlace | null {
  const municipalities = unique(rows.map((row) => normalizeAgs(row.geo_ags, 8)));
  const districts = unique(rows.map((row) => normalizeAgs(row.geo_ags5, 5)));
  if (municipalities.length !== 1 || districts.length !== 1) return null;

  const gemeindeAgs = municipalities[0];
  const kreisAgs = districts[0];
  const gemeindeName = adminNames.get(gemeindeAgs) ?? adminNames.get(gemeindeAgs.replace(/^0+/, "") || gemeindeAgs);
  const kreisName = adminNames.get(kreisAgs) ?? adminNames.get(kreisAgs.replace(/^0+/, "") || kreisAgs);
  if (!gemeindeName || !kreisName) return null;

  const landKeys = unique(rows.map((row) => normalizeAgs(row.geo_land, 2)));
  const landAgs = landKeys.length === 1 ? landKeys[0] : null;
  const landName = landAgs
    ? (adminNames.get(landAgs) ?? adminNames.get(landAgs.replace(/^0+/, "") || landAgs) ?? null)
    : null;

  return {
    gemeinde: { name: gemeindeName },
    kreis: { name: kreisName },
    land: landName ? { name: landName } : null,
    keys: placeKeys(gemeindeAgs, kreisAgs, landAgs),
  };
}

export function placeKeys(gemeindeAgs: string | null, kreisAgs: string | null, landAgs: string | null): PlaceKeys {
  const paddedKreis = kreisAgs && kreisAgs.length === 5 ? `${kreisAgs}000` : kreisAgs;
  return {
    gemeinde: gemeindeAgs ? keyVariants(gemeindeAgs, ["ags"]) : [],
    kreis: kreisAgs
      ? unique([...keyVariants(kreisAgs, ["ags", "ags5"]), ...(paddedKreis ? keyVariants(paddedKreis, ["ags"]) : [])])
      : [],
    land: landAgs ? keyVariants(landAgs, ["ags", "land"]) : [],
  };
}

function keyVariants(id: string, prefixes: readonly string[]): string[] {
  const bare = [id, id.replace(/^0+/, "") || id];
  const prefixed = prefixes.flatMap((prefix) => bare.map((value) => `${prefix}:${value}`));
  return unique([...bare, ...prefixed]);
}

function allLookupKeys(places: ResolvedPlace[]): string[] {
  return unique(places.flatMap((place) => [...place.keys.gemeinde, ...place.keys.kreis, ...place.keys.land]));
}

function topicFromDocs(id: TopicId, level: TopicLevel, keys: string[], docs: FeatureRow[]): AddressTopic {
  const matches = docs.filter((row) => rowMatches(row, id, level, keys));
  if (matches.length === 0) return { id, level, status: "absent" };

  if (id === "zensus2022") {
    const value = zensus2022Value(matches.map((row) => row.metadata));
    if (value === undefined) return { id, level, status: "absent" };
    return { id, level, status: "present", value };
  }

  const chosen = pickLatest(matches);
  return { id, level, status: "present", value: storedRowValue(chosen.metadata) };
}

function rowMatches(row: FeatureRow, id: TopicId, level: TopicLevel, keys: string[]): boolean {
  const theme = row.source_theme?.trim() ?? "";
  if (!theme || !themeMatchesTopic(theme, id)) return false;
  if (!grainMatchesTopic(row.grain, id, level)) return false;
  return rowKeyHits(row, keys);
}

function rowKeyHits(row: FeatureRow, keys: string[]): boolean {
  const wanted = new Set(keys);
  if (wanted.size === 0) return false;
  const candidates = [
    row.geo_key,
    metadataText(row.metadata, "geo_ags"),
    metadataText(row.metadata, "geo_ags5"),
    metadataText(row.metadata, "geo_land"),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (wanted.has(candidate)) return true;
    const stripped = stripKeyPrefix(candidate);
    if (wanted.has(stripped) || wanted.has(candidate)) return true;
    const digitsOnly = digits(stripped);
    if (digitsOnly && (wanted.has(digitsOnly) || wanted.has(padDigits(digitsOnly, digitsOnly.length)))) {
      return true;
    }
  }
  return false;
}

function pickLatest(rows: FeatureRow[]): FeatureRow {
  return [...rows].sort((left, right) => {
    const period = comparePeriod(right.ref_period, left.ref_period);
    if (period !== 0) return period;
    return (left.geo_key ?? "").localeCompare(right.geo_key ?? "");
  })[0]!;
}

function comparePeriod(left: string | null, right: string | null): number {
  return (left ?? "").localeCompare(right ?? "");
}

function metadataText(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stripKeyPrefix(value: string): string {
  const match = /^(?:ags|ags5|land|plz5|plz8):(.+)$/i.exec(value.trim());
  return match?.[1] ?? value.trim();
}

function normalizeAgs(value: string | null | undefined, width: number): string | null {
  const raw = digits(value);
  if (!raw) return null;
  if (raw.length > width) return null;
  return padDigits(raw, width);
}

function digits(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^[0-9]+$/.test(trimmed) ? trimmed : null;
}

function padDigits(value: string, width: number): string {
  return value.length >= width ? value : value.padStart(width, "0");
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

import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService, featuresReadQuery } from "../database/database.service";
import {
  isFeaturesAccessDenied,
  isMissingFeaturesRelation,
  isVectorQueryFailure,
} from "../database/pg-error";
import { toContainsPattern } from "../search/search.util";
import {
  FeatureColumnFlags,
  FeatureRelation,
  buildRegionSql,
  buildStoreSql,
  chooseRelation,
  flagsFromColumns,
} from "./brain-search.sql";
import { OmlxClient } from "./omlx.client";
import { roundCountMetricValue } from "./count-metrics";
import { throwIfAborted } from "./run-abort";
import {
  AnalysisBrain,
  AnalysisInput,
  AnalysisRegion,
  BrainFact,
  BrainMatch,
  BrainSignal,
  VectorUnavailableReason,
  analysisRegions,
} from "./types";

const SIGNAL_SKIP = new Set([
  "gemeinde_name",
  "geo_ags",
  "geo_ags5",
  "geo_land",
  "geo_land_name",
]);

interface FactRow {
  id: string;
  geo_key: string | null;
  grain: string;
  name: string | null;
  ref_period: string | null;
  title: string | null;
  content: string | null;
  metadata: unknown;
  source_theme: string | null;
  distance: number | string | null;
}

@Injectable()
export class BrainSearchService {
  private readonly logger = new Logger(BrainSearchService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly omlx: OmlxClient,
  ) {}

  /**
   * Kleinräumige Fakten for the customer's target region, plus PLZ facts
   * near their stores. Vector search is optional: without oMLX or without
   * an embedding column the same filters run as SQL.
   * KAN-5 will read the persisted pattern, not this result set, for Top-3.
   */
  async search(input: AnalysisInput, signal?: AbortSignal): Promise<AnalysisBrain> {
    throwIfAborted(signal);
    const chosen = await this.resolveRelation();
    if (!chosen) {
      return brainResult("sql", "features_unavailable", []);
    }

    const flags = flagsFromColumns(chosen.columns);
    const vectorAttempt = await this.tryVector(input, chosen.relation, flags, signal);
    if (vectorAttempt.facts) {
      return brainResult("vector", null, vectorAttempt.facts);
    }

    const facts = await this.collect(chosen.relation, flags, input, null, signal);
    return brainResult("sql", vectorAttempt.reason, facts);
  }

  private async resolveRelation(): Promise<{
    relation: FeatureRelation;
    columns: ReadonlySet<string>;
  } | null> {
    const tableColumns = await this.columnSet("location_feature_docs");
    const viewColumns = await this.columnSet("v_location_search");
    return chooseRelation(tableColumns, viewColumns);
  }

  private async tryVector(
    input: AnalysisInput,
    relation: FeatureRelation,
    flags: FeatureColumnFlags,
    signal?: AbortSignal,
  ): Promise<{ facts: BrainFact[] | null; reason: VectorUnavailableReason }> {
    const gate = this.omlx.vectorGate();
    if (!flags.embedding) {
      return {
        facts: null,
        reason: gate === "ready" ? "vector_query_failed" : gate,
      };
    }
    if (gate !== "ready") return { facts: null, reason: gate };

    const embedded = await this.omlx.embed(buildEmbeddingQuery(input));
    if (!embedded.ok) return { facts: null, reason: embedded.reason };

    try {
      const facts = await this.collect(relation, flags, input, embedded.vector, signal);
      if (facts.length === 0) {
        return { facts: null, reason: "no_embeddings_in_region" };
      }
      return { facts, reason: "embeddings_unconfigured" };
    } catch (error) {
      if (!isVectorQueryFailure(error)) throw error;
      this.logger.warn("Brain vector query failed; using the SQL filter.");
      return { facts: null, reason: "vector_query_failed" };
    }
  }

  private async collect(
    relation: FeatureRelation,
    flags: FeatureColumnFlags,
    input: AnalysisInput,
    vector: number[] | null,
    signal?: AbortSignal,
  ): Promise<BrainFact[]> {
    const useVector = vector !== null;
    const vectorLiteral = vector ? toVectorLiteral(vector) : null;
    const regions = analysisRegions(input);
    const seenFacts = new Set<string>();
    const regionFacts: BrainFact[] = [];
    for (const region of regions) {
      throwIfAborted(signal);
      const regionParams = [
        region.ags,
        region.plz,
        region.geoKey,
        labelPattern(region),
        vectorLiteral,
      ];
      const regionRows = await this.read(
        buildRegionSql(relation, flags, useVector),
        useVector ? regionParams : regionParams.slice(0, 4),
      );
      const regionMatch: BrainMatch = labelOnly(region) ? "label" : "region";
      for (const row of regionRows) {
        if (seenFacts.has(row.id)) continue;
        seenFacts.add(row.id);
        regionFacts.push(toFact(row, regionMatch));
      }
    }

    const storePlz = [
      ...new Set(
        input.stores
          .map((store) => store.postalCode)
          .filter((code) => /^[0-9]{5}$/.test(code)),
      ),
    ];
    if (storePlz.length === 0) return regionFacts;

    const storeParams: unknown[] = [storePlz];
    if (vectorLiteral) storeParams.push(vectorLiteral);
    const seen = new Set(regionFacts.map((fact) => fact.id));
    const storeRows = await this.read(buildStoreSql(relation, flags, useVector), storeParams);
    const storeFacts = storeRows
      .filter((row) => !seen.has(row.id))
      .map((row) => toFact(row, "store" as const));
    return [...regionFacts, ...storeFacts];
  }

  private async read(sql: string, params: unknown[]): Promise<FactRow[]> {
    try {
      const result = await featuresReadQuery(this.db)<FactRow>(sql, params);
      return result.rows;
    } catch (error) {
      if (isMissingFeaturesRelation(error) || isFeaturesAccessDenied(error)) return [];
      throw error;
    }
  }

  private async columnSet(relation: FeatureRelation): Promise<ReadonlySet<string> | null> {
    try {
      const result = await featuresReadQuery(this.db)<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'features'
           AND table_name = $1`,
        [relation],
      );
      if (result.rows.length === 0) return null;
      return new Set(result.rows.map((row) => row.column_name));
    } catch (error) {
      if (isMissingFeaturesRelation(error) || isFeaturesAccessDenied(error)) return null;
      throw error;
    }
  }
}

export function buildEmbeddingQuery(input: AnalysisInput): string {
  const places = input.stores
    .map((store) => `${store.postalCode} ${store.city}`.trim())
    .filter((value) => value.length > 0)
    .join(", ");
  const regions = analysisRegions(input);
  const labels = regions.map((region) => region.label).filter((label) => label.length > 0);
  const ags = regions.map((region) => region.ags).filter((value): value is string => Boolean(value));
  const plz = regions.map((region) => region.plz).filter((value): value is string => Boolean(value));
  const keys = regions
    .map((region) => region.geoKey)
    .filter((value): value is string => Boolean(value));
  return [
    "Kleinräumige Standortkriterien",
    labels.join(", "),
    ags.length > 0 ? `AGS ${ags.join(" ")}` : "",
    plz.length > 0 ? `PLZ ${plz.join(" ")}` : "",
    keys.join(" "),
    places ? `Filialen ${places}` : "",
    "Bevölkerung Haushalte Wohnungen Miete Leerstand Erwerb Gebäude",
  ]
    .filter((part) => part.length > 0)
    .join(". ");
}

function brainResult(
  mode: AnalysisBrain["mode"],
  reason: VectorUnavailableReason | null,
  facts: BrainFact[],
): AnalysisBrain {
  return {
    mode,
    vectorUnavailableReason: reason,
    factCount: facts.length,
    facts,
  };
}

function labelOnly(region: AnalysisRegion): boolean {
  return !region.ags && !region.plz && !region.geoKey;
}

function labelPattern(region: AnalysisRegion): string | null {
  if (!labelOnly(region)) return null;
  const label = region.label.trim();
  return label ? toContainsPattern(label) : null;
}

function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

function toFact(row: FactRow, matchedBy: BrainMatch): BrainFact {
  const title = (row.title ?? row.name ?? row.geo_key ?? row.id).trim();
  const distance = toDistance(row.distance);
  return {
    id: row.id,
    geoKey: row.geo_key ?? "",
    grain: row.grain,
    title,
    name: row.name,
    refPeriod: row.ref_period,
    excerpt: excerpt(row.content, title),
    distance,
    matchedBy,
    signals: signalsFrom(row.metadata, row.source_theme),
  };
}

function toDistance(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 1_000_000) / 1_000_000;
}

function excerpt(content: string | null, title: string): string {
  const source = (content ?? "").replace(/\s+/g, " ").trim();
  if (!source) return title;
  if (source.length <= 400) return source;
  return `${source.slice(0, 397)}...`;
}

function signalsFrom(metadata: unknown, sourceTheme: string | null): BrainSignal[] {
  const signals: BrainSignal[] = [];
  const metricId = sourceTheme?.trim() || undefined;
  if (metricId) {
    pushSignal(signals, "source_theme", metricId, metricId);
  }
  collectSignals(signals, metadata, "", metricId);
  return signals.slice(0, 6);
}

function collectSignals(
  signals: BrainSignal[],
  value: unknown,
  prefix: string,
  metricId?: string,
): void {
  if (signals.length >= 6 || !value || typeof value !== "object" || Array.isArray(value)) return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (signals.length >= 6) return;
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (SIGNAL_SKIP.has(fullKey)) continue;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      collectSignals(signals, nested, fullKey, metricId);
      continue;
    }
    pushSignal(signals, fullKey, nested, metricId);
  }
}

function pushSignal(signals: BrainSignal[], key: string, value: unknown, metricId?: string): void {
  if (signals.length >= 6 || value === null || value === undefined) return;
  if (typeof value === "number" && Number.isFinite(value)) {
    signals.push({ key, value: String(roundCountMetricValue(key, value, metricId)) });
    return;
  }
  if (typeof value === "boolean") {
    signals.push({ key, value: value ? "true" : "false" });
    return;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        signals.push({ key, value: String(roundCountMetricValue(key, numeric, metricId)) });
        return;
      }
    }
    signals.push({ key, value: trimmed.slice(0, 80) });
  }
}

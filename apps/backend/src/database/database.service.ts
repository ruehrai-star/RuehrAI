import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { readPgAnalysisPoolMax, readPgStatementTimeoutMs } from "../analysis/analysis-env";
import { isFeaturesRoleUnusable } from "./pg-error";
import { readPgPoolOptions } from "./pool-options";

export type SqlQuery = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) => Promise<QueryResult<T>>;

/** NOLOGIN role with SELECT on schema features. Set per transaction, never on the pooled session. */
export const FEATURES_READ_ROLE = "backend_ro_features";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;
  private readonly analysisPool: Pool;
  private readonly statementTimeoutMs: number;
  /** `role` uses SET LOCAL ROLE; `direct` means the role is missing and the connected user reads. */
  private featuresAccess: "unknown" | "role" | "direct" = "unknown";
  private readonly activeAnalysisClients = new Set<PoolClient>();
  private httpQueryCount = 0;
  private analysisQueryCount = 0;

  constructor(config: ConfigService) {
    const connectionString = config.get<string>("DATABASE_URL");
    if (!connectionString) {
      throw new Error("DATABASE_URL is required");
    }

    const poolOptions = readPgPoolOptions((key) => config.get<string>(key));
    this.pool = new Pool({
      connectionString,
      application_name: "ruehrai-backend",
      ...poolOptions,
    });
    this.pool.on("error", (error) => {
      this.logger.error("Unexpected Postgres client error", error.stack);
    });

    const analysisMax = readPgAnalysisPoolMax((key) => config.get<string>(key));
    this.statementTimeoutMs = readPgStatementTimeoutMs((key) => config.get<string>(key));
    this.analysisPool = new Pool({
      connectionString,
      application_name: "ruehrai-backend-analysis",
      ...poolOptions,
      max: analysisMax,
    });
    this.analysisPool.on("error", (error) => {
      this.logger.error("Unexpected analysis Postgres client error", error.stack);
    });
  }

  /** Call counters for tests. HTTP pool vs analysis-worker pool. */
  poolCounters(): { http: number; analysis: number } {
    return { http: this.httpQueryCount, analysis: this.analysisQueryCount };
  }

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    this.httpQueryCount += 1;
    return this.pool.query<T>(text, params);
  }

  /**
   * App-schema reads/writes for the Musteranalyse worker. Separate pool plus
   * `SET LOCAL statement_timeout` so a run cannot occupy the HTTP pool.
   */
  queryAnalysis<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.runAppQuery(this.analysisPool, text, params, true);
  }

  /** Run `fn` in one transaction. A thrown error rolls the transaction back. */
  async withTransaction<T>(fn: (query: SqlQuery) => Promise<T>): Promise<T> {
    return this.runTransaction(this.pool, fn, false, false);
  }

  /** Worker-path transaction on the analysis pool, with statement_timeout. */
  async withAnalysisTransaction<T>(fn: (query: SqlQuery) => Promise<T>): Promise<T> {
    return this.runTransaction(this.analysisPool, fn, true, true);
  }

  /**
   * Read schema `features` as `backend_ro_features` when that role can be set.
   * SET LOCAL ROLE is transaction-scoped so the connection returns to the pool
   * as the DATABASE_URL user (needed for writes to schema `app`).
   * If the role does not exist, the statement runs as the connected user.
   */
  async queryReadingFeatures<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.runFeaturesQuery(this.pool, text, params, false);
  }

  /**
   * Brain geo/feature reads for Musteranalyse. Separate small pool plus
   * `SET LOCAL statement_timeout` so a long analysis query cannot fill the
   * main HTTP pool. Falls back to `queryReadingFeatures` semantics.
   */
  async queryAnalysisFeatures<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.runFeaturesQuery(this.analysisPool, text, params, true);
  }

  /**
   * Cancel in-flight analysis-pool queries via a **separate** connection, then
   * discard those clients so they are not reused.
   */
  async cancelAnalysisWork(): Promise<void> {
    const clients = [...this.activeAnalysisClients];
    for (const client of clients) {
      const pid = (client as PoolClient & { processID?: number }).processID;
      if (pid) {
        try {
          await this.analysisPool.query("SELECT pg_cancel_backend($1)", [pid]);
        } catch (error) {
          this.logger.warn(`pg_cancel_backend(${pid}) failed (${messageOf(error)}).`);
        }
      }
      this.activeAnalysisClients.delete(client);
      try {
        client.release(true);
      } catch {
        // Already released by the query's finally.
      }
    }
  }

  bindAnalysisAbort(signal: AbortSignal): () => void {
    const onAbort = () => {
      void this.cancelAnalysisWork();
    };
    signal.addEventListener("abort", onAbort);
    return () => signal.removeEventListener("abort", onAbort);
  }

  private async runTransaction<T>(
    pool: Pool,
    fn: (query: SqlQuery) => Promise<T>,
    withStatementTimeout: boolean,
    analysis: boolean,
  ): Promise<T> {
    if (analysis) this.analysisQueryCount += 1;
    else this.httpQueryCount += 1;
    const client = await pool.connect();
    if (analysis) this.activeAnalysisClients.add(client);
    const query: SqlQuery = (text, params = []) => client.query(text, params);
    let discard: Error | boolean | undefined;
    try {
      await client.query("BEGIN");
      if (withStatementTimeout) {
        await client.query(`SET LOCAL statement_timeout = ${this.statementTimeoutMs}`);
      }
      const result = await fn(query);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      discard = error instanceof Error ? error : true;
      throw error;
    } finally {
      this.activeAnalysisClients.delete(client);
      if (discard) client.release(discard);
      else client.release();
    }
  }

  private async runAppQuery<T extends QueryResultRow>(
    pool: Pool,
    text: string,
    params: unknown[],
    analysis: boolean,
  ): Promise<QueryResult<T>> {
    return this.runTransaction(pool, (query) => query<T>(text, params), true, analysis);
  }

  private async runFeaturesQuery<T extends QueryResultRow>(
    pool: Pool,
    text: string,
    params: unknown[],
    withStatementTimeout: boolean,
  ): Promise<QueryResult<T>> {
    if (withStatementTimeout) this.analysisQueryCount += 1;
    else this.httpQueryCount += 1;
    const client = await pool.connect();
    if (withStatementTimeout) this.activeAnalysisClients.add(client);
    let discard: Error | boolean | undefined;
    try {
      const mode = await this.resolveFeaturesAccess(client);
      await client.query("BEGIN");
      if (mode === "role") {
        await client.query(`SET LOCAL ROLE ${FEATURES_READ_ROLE}`);
      }
      if (withStatementTimeout) {
        await client.query(`SET LOCAL statement_timeout = ${this.statementTimeoutMs}`);
      }
      const result = await client.query<T>(text, params);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      discard = error instanceof Error ? error : true;
      throw error;
    } finally {
      this.activeAnalysisClients.delete(client);
      if (discard) client.release(discard);
      else client.release();
    }
  }

  private async resolveFeaturesAccess(client: PoolClient): Promise<"role" | "direct"> {
    if (this.featuresAccess !== "unknown") return this.featuresAccess;
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${FEATURES_READ_ROLE}`);
      await client.query("ROLLBACK");
      this.featuresAccess = "role";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (!isFeaturesRoleUnusable(error)) throw error;
      this.featuresAccess = "direct";
      this.logger.warn(
        `${FEATURES_READ_ROLE} cannot be set; feature reads use the DATABASE_URL user. Grant that role, or GRANT SELECT on features to the user.`,
      );
    }
    return this.featuresAccess;
  }

  async onModuleDestroy(): Promise<void> {
    await this.cancelAnalysisWork().catch(() => undefined);
    await Promise.all([this.pool.end(), this.analysisPool.end()]);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

export type AnalysisQueryDb = Pick<DatabaseService, "query"> & {
  queryAnalysis?: DatabaseService["queryAnalysis"];
  withAnalysisTransaction?: DatabaseService["withAnalysisTransaction"];
  bindAnalysisAbort?: DatabaseService["bindAnalysisAbort"];
  cancelAnalysisWork?: DatabaseService["cancelAnalysisWork"];
};

/** Worker writes: analysis pool when present, otherwise the mock `query`. */
export function analysisWriteQuery(db: AnalysisQueryDb): DatabaseService["query"] {
  if (typeof db.queryAnalysis === "function") {
    return (text, params) => db.queryAnalysis!(text, params);
  }
  return (text, params) => db.query(text, params);
}

export async function analysisTransaction<T>(
  db: AnalysisQueryDb,
  fn: (query: SqlQuery) => Promise<T>,
): Promise<T> {
  if (typeof db.withAnalysisTransaction === "function") {
    return db.withAnalysisTransaction(fn);
  }
  const query: SqlQuery = (text, params = []) => db.query(text, params);
  return fn(query);
}

/** Prefer the analysis pool when the mock/service exposes it. */
export function featuresReadQuery(
  db: Pick<DatabaseService, "queryReadingFeatures"> & {
    queryAnalysisFeatures?: DatabaseService["queryAnalysisFeatures"];
  },
): DatabaseService["queryReadingFeatures"] {
  if (typeof db.queryAnalysisFeatures === "function") {
    return (text, params) => db.queryAnalysisFeatures!(text, params);
  }
  return (text, params) => db.queryReadingFeatures(text, params);
}

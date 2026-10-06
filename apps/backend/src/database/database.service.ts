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

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  /** Run `fn` in one transaction. A thrown error rolls the transaction back. */
  async withTransaction<T>(fn: (query: SqlQuery) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const query: SqlQuery = (text, params = []) => client.query(text, params);
    try {
      await client.query("BEGIN");
      const result = await fn(query);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
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

  private async runFeaturesQuery<T extends QueryResultRow>(
    pool: Pool,
    text: string,
    params: unknown[],
    withStatementTimeout: boolean,
  ): Promise<QueryResult<T>> {
    const client = await pool.connect();
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
      throw error;
    } finally {
      client.release();
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
    await Promise.all([this.pool.end(), this.analysisPool.end()]);
  }
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

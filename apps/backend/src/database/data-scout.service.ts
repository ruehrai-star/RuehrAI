import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool, QueryResult, QueryResultRow } from "pg";

/**
 * Read-only pool for the Eule Data-Scout database (`geo_ref_*`).
 * Separate from Brain `DATABASE_URL`. Unset or unreachable: callers fall
 * back to the PLZ catalog. This service never writes.
 */
@Injectable()
export class DataScoutService implements OnModuleDestroy {
  private readonly logger = new Logger(DataScoutService.name);
  private readonly pool: Pool | null;

  constructor(config: ConfigService) {
    const connectionString = config.get<string>("DATASCOUT_DATABASE_URL")?.trim();
    if (!connectionString) {
      this.pool = null;
      this.logger.warn(
        "DATASCOUT_DATABASE_URL is unset; store pins fall back to the PLZ catalog.",
      );
      return;
    }

    try {
      this.pool = new Pool({
        connectionString,
        max: 4,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
        statement_timeout: 8_000,
        application_name: "ruehrai-backend-datascout",
        options: "-c default_transaction_read_only=on",
      });
    } catch (error) {
      this.pool = null;
      this.logger.error(
        `Data-Scout pool was not created (${errorText(error)}). Store pins fall back to the PLZ catalog.`,
      );
      return;
    }

    this.pool.on("error", (error) => {
      this.logger.error(`Unexpected Data-Scout client error: ${error.message}`);
    });
  }

  get enabled(): boolean {
    return this.pool !== null;
  }

  /** Single SELECT. Anything else is refused. Failures return null. */
  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T> | null> {
    if (!this.pool) return null;
    if (!isSingleSelect(text)) {
      this.logger.error("Refused a Data-Scout statement that is not a single SELECT");
      return null;
    }
    try {
      return await this.pool.query<T>(text, params);
    } catch (error) {
      this.logger.warn(`Data-Scout read failed; falling back. ${errorText(error)}`);
      return null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}

function isSingleSelect(text: string): boolean {
  const trimmed = text.trim();
  return /^select\b/i.test(trimmed) && !trimmed.includes(";");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

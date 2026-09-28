import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { loadLocalEnv } from "./load-local-env";

async function main(): Promise<void> {
  loadLocalEnv();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required (copy .env.example to .env)");
  }

  const migrationsDir = join(process.cwd(), "db/migrations");
  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    application_name: "ruehrai-migrate",
  });

  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS app");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app.schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const file of files) {
      const applied = await pool.query(
        "SELECT 1 FROM app.schema_migrations WHERE version = $1",
        [file],
      );
      if (applied.rowCount) {
        console.log(`skip ${file}`);
        continue;
      }

      const sql = await readFile(join(migrationsDir, file), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          "INSERT INTO app.schema_migrations (version) VALUES ($1)",
          [file],
        );
        await client.query("COMMIT");
        console.log(`apply ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

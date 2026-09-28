# Supabase → Brain sync

Status und Zählung: [README.md](README.md). Lebender DDL-Stand: [schema.sql](schema.sql). Load-Schritte: [pipeline.md](pipeline.md).

## Roles of the two databases

| System | Role |
| --- | --- |
| **Supabase** `tyfwdjzkfvuhasnebhvo` | Source of truth for tabular pulls only (Zensus / Destatis / future themes). Not app-facing. |
| **Brain** (Mac Postgres.app, DB `Brain`) | App-facing store: feature documents, vectors, search projection. Backend reads from here. |

Anon REST against Supabase is blocked by RLS for these tables → export via Supabase MCP `execute_sql` (chunked `json_agg`).

## Schema split on Brain

| Schema | Owner / purpose |
| --- | --- |
| `features` | Data-Engineer. Location feature docs, embedding jobs, search view. |
| `app` | Placeholder. Backend owns app DDL later. `ruehrai` has `USAGE, CREATE`. |
| `public` | No longer holds feature docs (moved 2026-09-28). |

### Key objects in `features`

- `features.location_feature_docs` — documents (`content` for embeddings, `embedding vector(1536)` nullable)
- `features.embedding_jobs` — job ledger
- `features.v_location_search` — Backend `/search` projection:
  `id, geo_key, grain, ref_period, name, title, lon, lat, source_theme, source_tables, metadata, supabase_synced_at, embedding`
  (`embedding` is nullable; Backend ignores until filled)

Extra columns on docs (Backend): `name`, `lon`, `lat`, `source_theme` (nullable).
`name` is backfilled from `metadata->>'gemeinde_name'` when present. `lon`/`lat`/`source_theme` stay null until a later enrichment.

### Privileges

- Role `backend_ro_features` **NOLOGIN** — `USAGE` on schema `features`, `SELECT` on all current + future tables/views (via `ALTER DEFAULT PRIVILEGES` for `ruehrai`).
- `GRANT backend_ro_features TO ruehrai` so the local `DATABASE_URL` user can `SET ROLE backend_ro_features`.
- No LOGIN role and no passwords are created by Data-Engineer scripts.

Migration (folded into the live contract): [schema.sql](schema.sql). Applied source script outside the repo: `scripts/03_features_schema.sql` (idempotent where possible).

## Pipeline steps

1. **Chunked SQL export** from Supabase (MCP `execute_sql`) → `data/chunks/chunk_*.json`
   Helper: `scripts/extract_mcp_chunk.py`
2. **Build docs** (German prose + metadata CSV):
   `python3 scripts/build_location_feature_docs.py data/chunks data/location_feature_docs.csv`
3. **Upsert into Brain**:
   `scripts/load_to_brain.sh /path/to/location_feature_docs.csv`
   → `INSERT … ON CONFLICT` into **`features.location_feature_docs`** (unique on `(geo_key, grain, coalesce(ref_period,''))`), sets `supabase_synced_at = now()`.

Join SQL template: `scripts/zensus_join_query.sql`.

After a load, backfill / refresh display fields if needed:

```sql
UPDATE features.location_feature_docs
SET name = metadata->>'gemeinde_name'
WHERE name IS NULL AND metadata->>'gemeinde_name' IS NOT NULL;
```

## Env keys Backend expects

Connection to Brain (no secret values in this doc — use secret store / env):

| Key | Notes |
| --- | --- |
| `DATABASE_URL` | Primary. Postgres URL for Brain (`host`, `port`, `user`, `dbname`; password from secret store). |
| `PGHOST` / `PGPORT` / `PGUSER` / `PGDATABASE` / `PGPASSWORD` | Optional libpq overrides if not using `DATABASE_URL`. Names only; never commit values. |

Suggested app usage: connect as `ruehrai` (or whatever `DATABASE_URL` user), then `SET ROLE backend_ro_features` for read-only feature access.

Do **not** invent or commit passwords. Do **not** create LOGIN roles with passwords in Data-Engineer migrations.

## Current batch status (2026-09-28, Europe/Berlin)

| Item | Status |
| --- | --- |
| Batch | Zensus 2022 Gemeinden (`grain=ags`, `ref_period=2022-05`) |
| Rows in `features.location_feature_docs` | **10 786** |
| `name` filled | 10 786 (from `gemeinde_name`) |
| `lon` / `lat` / `source_theme` | all NULL (await enrichment) |
| `embedding` | all NULL |
| `embedding_jobs` | 1 row, `status=pending`, `row_count=10786` |
| View `features.v_location_search` | works, same 10 786 rows. Backend `/search` reads this view. |
| Source tables | `zensus2022_demografie_gemeinden` + bevoelkerung / haushalte / wohnungen / erwerbsstatus / gebaeude |
| Destatis Kreise (`ags5`) | not in this batch |

Verify artifact: `/workspace/data-engineer/verify-features-schema.txt` (mirror on Mac under `~/data-engineer/`).

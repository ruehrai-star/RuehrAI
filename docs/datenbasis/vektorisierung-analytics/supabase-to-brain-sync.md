# Data-Scout → Brain sync

Filename stays `supabase-to-brain-sync.md`.

Status and counts: [README.md](README.md). Living DDL: [schema.sql](schema.sql). Load steps: [pipeline.md](pipeline.md).

Snapshot: **2026-10-04 ~10:25 Europe/Berlin**, Brain STAGE on Eule. No secrets. No PROD write.

## Roles

| System | Role |
| --- | --- |
| **Supabase** `tyfwdjzkfvuhasnebhvo` | Transient pull only. Not the durable source Brain reads. Not app-facing. |
| **Data-Scout** (Eule, DB `Data-Scout`) | Durable raw tabular store. Brain pipelines **read only** from here. |
| **Brain STAGE** (Eule, Postgres.app, DB `Brain`) | Feature documents, vectors, `geo` catalog mirror, `app` (Backend). |
| **Brain PROD** (Fuchs) | Promote Modell B only after an explicit Go. Out of scope for this document. |

Anon REST against Supabase stays blocked by RLS for the pulled tables. A Supabase export is a transient pull, not a second durable store.

## Schema split on Brain STAGE

| Schema | Owner / purpose |
| --- | --- |
| `features` | Data-Engineer. Location feature docs, embedding jobs, search view, HNSW. |
| `app` | Backend-owned. Live tables exist. Their DDL is not in this folder. |
| `geo` | Catalog mirror (`geo_ref_*`), not feature docs. DDL is not in this folder. |
| `public` | No longer holds feature docs (moved 2026-09-28). |

### Key objects in `features`

- `features.location_feature_docs` — documents. `embedding` is **`vector(1024)`**, nullable.
- `features.embedding_jobs` — job ledger.
- `features.v_location_search` — Backend `/search` projection. Column list unchanged:
  `id, geo_key, grain, ref_period, name, title, lon, lat, source_theme, source_tables, metadata, supabase_synced_at, embedding`.
- `location_feature_docs_embedding_hnsw` — cosine HNSW on `embedding`. Similarity reads of `features.v_location_search` use it.

Unique key: `(geo_key, grain, COALESCE(ref_period, ''))`. When two themes share a period, `ref_period` carries a theme suffix (example `2025-12|bka`). Allowed grains: `address`, `grid100`, `plz8`, `plz5`, `ags`, `ags5`, `other`.

Columns `name`, `lon`, `lat`, `source_theme` stay on the docs. This snapshot does not publish a fill count for them. One known exception in the hospital rows: Destatis `krankenhaeuser` `2024-12|kh` has lon 0 (3 027 rows).

### Privileges

- Role `backend_ro_features` **NOLOGIN** — `USAGE` on schema `features`, `SELECT` on all current and future tables and views in `features` (`ALTER DEFAULT PRIVILEGES` for `ruehrai`). `SELECT` also on `geo.geo_ref_plz`, `geo.geo_ref_bezirk`, `geo.geo_ref_ortsteil`, `geo.geo_ref_admin`.
- `GRANT backend_ro_features TO ruehrai` so the `DATABASE_URL` user can `SET ROLE backend_ro_features`.
- No LOGIN role and no passwords are created by Data-Engineer scripts.

Living DDL: [schema.sql](schema.sql).

### Schema `geo` (catalog mirror)

| Table | Rows | Notes |
| --- | --- | --- |
| `geo.geo_ref_plz` | 8175 | geom 4326 (from 3035). Catalog key `geo_plz5`. PK `geo_plz8`. |
| `geo.geo_ref_bezirk` | 429 | geom 4326. Berlin `11000001`–`11000012`. |
| `geo.geo_ref_ortsteil` | 19781 | geom 4326. |
| `geo.geo_ref_admin` | 11356 | names. geom often NULL. |

## Pipeline steps

1. Read durable rows from **Data-Scout** (read only).
2. Build feature docs and upsert into **`features.location_feature_docs`** on Brain STAGE. `INSERT … ON CONFLICT` on `(geo_key, grain, coalesce(ref_period, ''))`. The loader sets `supabase_synced_at = now()` where that loader is the one writing the row.
3. Embed on Eule oMLX, base URL `http://localhost:8000/v1`, model `jina-embeddings-v5-text-small-retrieval-mlx-oQ8`, stored as `vector(1024)`. The API credential stays in the secret store.
4. Leave cosine HNSW `location_feature_docs_embedding_hnsw` in place. Do not build a second ANN index for this contract.
5. Backend connects with `DATABASE_URL` as `ruehrai`, then `SET ROLE backend_ro_features`, and reads `/search` from `features.v_location_search`.

Optional name backfill when `gemeinde_name` is present and `name` is still null:

```sql
UPDATE features.location_feature_docs
SET name = metadata->>'gemeinde_name'
WHERE name IS NULL AND metadata->>'gemeinde_name' IS NOT NULL;
```

## Env keys Backend expects

Connection to Brain STAGE (no secret values in this doc):

| Key | Notes |
| --- | --- |
| `DATABASE_URL` | Primary. Postgres URL for Brain STAGE (`host`, `port`, `user`, `dbname`). Password from the secret store. |
| `PGHOST` / `PGPORT` / `PGUSER` / `PGDATABASE` / `PGPASSWORD` | Optional libpq overrides if not using `DATABASE_URL`. Names only. Never commit values. |

Do **not** invent or commit passwords, tokens, or API keys. Do **not** create LOGIN roles with passwords in Data-Engineer migrations.

## Current batch status (2026-10-04, Europe/Berlin)

| Item | Status |
| --- | --- |
| Rows in `features.location_feature_docs` | **4 088 102** |
| With embedding | **937 816** |
| NULL embedding | **3 150 286** (grids only) |
| Non-grid docs | **139 096**, all embedded (`null_emb=0`) |
| `embedding` type | `vector(1024)` |
| HNSW | `location_feature_docs_embedding_hnsw` (cosine), used by `features.v_location_search` |
| Embed API | Eule oMLX `http://localhost:8000/v1`, model `jina-embeddings-v5-text-small-retrieval-mlx-oQ8` |
| Extensions | pgvector 0.8.6, PostGIS 3.6.3 |
| View | `features.v_location_search`, same column list. Backend `/search` reads it. |

### Themes

Non-grid themes all have `null_emb=0`.

Core / earlier batches:

| Theme | Grain | `ref_period` | Rows |
| --- | --- | --- | --- |
| zensus2022 | ags | 2022-05 | 10786 |
| destatis | ags5 | 2025-12 | 477 |
| wwk | ags | 2023 | 3103 |
| regionalstatistik_bevoelkerung | ags | 2025-12 | 13567 |
| regionalstatistik_wanderungen | ags | 2024 | 13567 |

2026-10-03 morning:

| Theme | Grain | `ref_period` | Rows |
| --- | --- | --- | --- |
| ba_pendler | ags / ags5 / other | 2025-06 | 10752 + 294 + 36 |
| ba_alo | ags | 2026-09 | 401 |
| bka_pks | ags / ags5 | 2025-12\|bka | 80 + 400 |
| boris_brw | ags | 2026-01 | 809 (Gemeinde aggregate, not the zone extract) |
| gerda | ags | 2025-02 | 10753 |
| bundeswahlleiter | ags | 2024-11 | 10956 |
| destatis_baugenehmigung | other | 2025\|bau | 16 |
| kmk | other | 2024\|kmk | 16 |
| kba_besitz | other | 2026-08\|kba | 17 |
| daten_bw | ags5 | 2024-06 | 44 |
| open_nrw | — | — | small (Kleve/Neuss); no separate count in this snapshot |
| dehoga | other | 2026-Q1\|dehoga | 17 |
| bbsr_nuts | other | 2024\|bbsr | 456 |
| statistikportal_gv | ags | 2025-12\|gv | 10953 |

2026-10-03 evening, eight tables, all embedded:

| Theme | Grain | `ref_period` | Rows |
| --- | --- | --- | --- |
| zensus_gw_gebaeude | ags | 2022-05\|gw_gebaeude | 10786 |
| zensus_gw_wohnungen | ags | 2022-05\|gw_wohnungen | 10786 |
| unfallatlas | ags / ags5 | 2025\|unfallatlas | 9375 + 104 (year 2025 only, not the point extract) |
| breitband | ags | 2025-12\|breitband | 11002 (Gemeinde Excel only) |
| vgrdl_einkommen | ags5 | 2024\|vgrdl | 398 |
| krankenhaeuser | other | 2026-09\|kh | 1571 (BKA) |
| krankenhaeuser | other | 2024-12\|kh | 3027 (Destatis, lon 0) |
| uba_luft | other | 2025\|uba_luft | 615 |
| rwi_redx | ags | 2025-11\|rwi | 3906 |

Grids (loaded; embeddings still running on the morning of 2026-10-04). Screen `embed_grids_b` was detached and still running on Eule.

| Theme | Grain | `ref_period` | Rows | Embedded | NULL |
| --- | --- | --- | --- | --- | --- |
| breitband_gitter | grid100 | 2025-12\|gitter | 3 590 703 | 798 752 (22.2%) | 2 791 951 |
| dwd_temp_1km | other | 2025\|dwd | 358 303 | 0 | 358 303 |

`breitband_gitter` key: `raster_rowid` (there is no `raster_id` column). `geo_grid100_id` appears in the prose, not as the key. No 100 m ZIP reload.

`dwd_temp_1km`: year 2025. °C = `value_tenth/10`. Key `dwd1km:{col}:{row}`.

## Skips

- `dwd_cdc_raster_catalog` (70 files, no cell values, no area key)
- anonymous `rwi_grid` (~242 000, no area key)
- 100 m broadband ZIP reload
- public-transport GTFS stops / catalogs without geo
- older history periods beyond the chosen `ref_period`
- PROD / Fuchs promote

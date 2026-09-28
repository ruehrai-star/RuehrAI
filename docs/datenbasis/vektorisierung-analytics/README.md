# Vektorisierung & Analytics

Aus Supabase-Facts und `geo_ref_*` werden Standort-Feature-Dokumente und später Embeddings. Supabase bleibt die relationale Quelle. Die Vektorablage ist die lokale Datenbank **Brain** (Postgres + pgvector), nicht ein zweites Supabase-Projekt.

**Owner:** Data-Engineer

**Confluence:** [Vektorisierung & Analytics](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/21856257)

Vertrag für Backend: [supabase-to-brain-sync.md](supabase-to-brain-sync.md).

## Status

**ANGELEGT.** Stand 2026-09-28: Auf Brain gilt der Schema-Split `features` (Data-Engineer) gegen `app` (Backend-Platzhalter). Die 10.786 Zensus-Gemeinden-Docs (`grain=ags`) liegen weiter in Brain, jetzt unter `features.location_feature_docs`. Embeddings sind noch leer.

### Schema-Split

| Schema | Owner | Zweck |
| --- | --- | --- |
| `features` | Data-Engineer | Feature-Docs, Embedding-Jobs, Search-View |
| `app` | Backend | Platzhalter. App-DDL gehört später Backend. `ruehrai` hat `USAGE` und `CREATE`. |
| `public` | — | Hält die Feature-Docs nicht mehr. Verschoben am 2026-09-28. |

| Feld | Wert |
| --- | --- |
| Maschine | RuehrAI Mac, Postgres.app |
| Host / Port | `127.0.0.1` (localhost) / `5432` |
| Datenbank | `Brain` |
| Connect | `DATABASE_URL`, User `ruehrai`. Passwort nur im Secret-Store. |
| Lese-Rolle | `backend_ro_features` **NOLOGIN**, read-only. Nach dem Connect: `SET ROLE backend_ro_features`. |
| Extension | `pgvector` **0.8.6** (enabled) |
| Vektorindex | keiner (kein HNSW, kein IVFFlat) |

Objekte, die am 2026-09-28 aus `public` nach `features` gezogen wurden:

| Objekt | Zweck |
| --- | --- |
| `features.location_feature_docs` | Dokumente (`content` für Embeddings, `embedding vector(1536)` nullable) |
| `features.embedding_jobs` | Job-Ledger |
| `features.v_location_search` | Projektion für Backend `/search` |

Erster Batch, weiter geladen (nicht neu gezogen):

| Feld | Wert |
| --- | --- |
| Zeilen | 10.786 |
| `grain` | `ags` |
| `geo_key` | `geo_ags` (achtstelliger AGS) |
| `ref_period` | `2022-05` |
| `name` | 10.786 gefüllt, aus `metadata->>'gemeinde_name'` |
| `lon` / `lat` / `source_theme` | alle NULL (Anreicherung offen) |
| `embedding` | `vector(1536)`, alle NULL |

`features.embedding_jobs`, eine Zeile:

| `id` | `status` | `row_count` |
| --- | --- | --- |
| 1 | `pending` | 10786 |

`features.v_location_search` liefert dieselben 10.786 Zeilen. Spalten: `id`, `geo_key`, `grain`, `ref_period`, `name`, `title`, `lon`, `lat`, `source_theme`, `source_tables`, `metadata`, `supabase_synced_at`, `embedding`. `embedding` bleibt nullable; Backend ignoriert es, bis es gefüllt ist.

DDL, lebender Stand (Initial-Create und angewendete Features-Migration in einer Datei): [schema.sql](schema.sql). Refresh: [pipeline.md](pipeline.md).

## Tabellen / Artefakte

Pipeline:

1. Supabase `scout_*` → Fact-Tabellen → `geo_ref_*` (Projekt `tyfwdjzkfvuhasnebhvo`, Schema `public`)
2. Feature-Docs in `features.location_feature_docs`
3. Jobs in `features.embedding_jobs`
4. Backend `/search` liest `features.v_location_search`
5. Similarity, sobald `embedding` gefüllt ist

Kernfelder von `features.location_feature_docs`: `geo_key`, `grain` (`address`, `grid100`, `plz8`, `plz5`, `ags`, `ags5`, `other`), `ref_period`, `title`, `content`, `metadata` (jsonb), `embedding` (`vector(1536)`, nullable), `source_tables`, `supabase_synced_at`, dazu die Backend-Spalten `name`, `lon`, `lat`, `source_theme` (alle nullable).

Eindeutigkeit: `(geo_key, grain, coalesce(ref_period, ''))` über den Index `location_feature_docs_geo_uniq`. Weitere B-Tree-Indizes auf `grain`, `geo_key` und `ref_period`.

`backend_ro_features` ist **NOLOGIN** und bekommt kein Passwort. Die Rolle hat `USAGE` auf Schema `features` und `SELECT` auf alle aktuellen Tabellen, Views und Sequences. `ALTER DEFAULT PRIVILEGES` für `ruehrai` zieht künftige Objekte in `features` nach. `GRANT backend_ro_features TO ruehrai` erlaubt `SET ROLE` nach dem Connect über `DATABASE_URL`. Data-Engineer-Skripte legen keine LOGIN-Rolle an.

Erster Batch, Quellen in Supabase (Join über `geo_ags` und `ref_period`, Basis `zensus2022_demografie_gemeinden`):

- `zensus2022_demografie_gemeinden`
- `zensus2022_bevoelkerung_gemeinden`
- `zensus2022_haushalte_gemeinden`
- `zensus2022_wohnungen_gemeinden`
- `zensus2022_erwerbsstatus_gemeinden`
- `zensus2022_gebaeude_gemeinden`

Siehe [Quelle 02](../quellen-und-abrufe/quelle-02-zensus-2022.md). Anon-REST ist durch RLS blockiert; der Export lief über privilegiertes SQL (MCP `execute_sql`, Chunks), ohne Keys im Repo.

Dokumentform dieses Batches:

| Feld | Inhalt |
| --- | --- |
| `title` | `Gemeinde {name} ({ags}) — Zensus 2022` |
| `content` | deutscher Fließtext (Bevölkerung, Alter, Haushalte, Wohnungen/Miete/Leerstand, Erwerb, Gebäude) |
| `metadata` | jsonb mit Kennzahlen plus `gemeinde_name`, `geo_ags5`, `geo_land`, `geo_land_name` |
| `name` | Anzeigename, backfill aus `metadata->>'gemeinde_name'` (10.786 gefüllt) |
| `lon`, `lat`, `source_theme` | NULL |
| `embedding` | NULL, Job später |

Loader, Chunks und CSV liegen außerhalb des Repos: Box `/workspace/data-engineer/`, Mac `/Users/ruehrai/data-engineer/`. Verify-Artefakt der Features-Migration: `/workspace/data-engineer/verify-features-schema.txt` (Spiegel auf dem Mac unter `~/data-engineer/`).

## How to refresh

1. Fact-Tabellen in Supabase sind aktuell (RLS blockiert Anon-REST; Export über einen berechtigten SQL-Pfad, nicht über eingecheckte Keys).
2. Feature-Docs bauen und idempotent nach `features.location_feature_docs` upserten. Der Loader setzt `supabase_synced_at = now()`.
3. Display-Name nachziehen, wo er leer ist: `name = metadata->>'gemeinde_name'`.
4. Jobzeile in `features.embedding_jobs` prüfen. Der geladene Batch ist `id=1`, `status=pending`, `row_count=10786`.
5. CSV-Zwischendateien nicht committen. Schritte und lokale Pfade: [pipeline.md](pipeline.md). Vertrag: [supabase-to-brain-sync.md](supabase-to-brain-sync.md).

## Open issues

- Embedding-Modell ist nicht festgelegt; `embedding` ist auf allen 10.786 Zeilen NULL. `features.embedding_jobs.id=1` bleibt `pending`.
- `lon`, `lat` und `source_theme` sind auf allen 10.786 Zeilen NULL. Anreicherung ist offen.
- HNSW oder IVFFlat erst nach den ersten Embeddings.
- Zweiter Batch Destatis Kreis (`grain=ags5`) ist offen. Vorhanden, nicht in diesem Batch: `destatis_bevoelkerung_kreise`, `destatis_bevoelkerung_alter`, `destatis_auslaender_kreise` ([Quelle 01](../quellen-und-abrufe/quelle-01-destatis-genesis.md)).
- Feinere Grains warten auf `geo_ref_*`.
- Refresh-Cadence ist noch nicht an die Quell-Cadence gekoppelt.
- Ausführbare Loader liegen noch nicht im Repo. Schema `app` ist leer; Backend besitzt das DDL dort später.

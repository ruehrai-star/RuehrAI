# Vektorisierung & Analytics

Aus Supabase-Facts und `geo_ref_*` werden Standort-Feature-Dokumente und später Embeddings. Supabase bleibt die relationale Quelle. Die Vektorablage ist die lokale Datenbank **Brain** (Postgres + pgvector), nicht ein zweites Supabase-Projekt.

**Owner:** Data-Engineer

**Confluence:** [Vektorisierung & Analytics](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/21856257)

## Status

**ANGELEGT.** Stand 2026-09-28: `location_feature_docs` und `embedding_jobs` sind in Brain angelegt und der erste Feature-Doc-Batch ist geladen. Embeddings sind noch leer.

| Feld | Wert |
| --- | --- |
| Maschine | RuehrAI Mac, Postgres.app |
| Host / Port | `127.0.0.1` (localhost) / `5432` |
| Datenbank | `Brain` |
| Rolle | `ruehrai` |
| Credentials | nur Secret-Store |
| Extension | `pgvector` **0.8.6** (enabled) |
| Vektorindex | keiner (kein HNSW, kein IVFFlat) |

Erster Batch in `location_feature_docs`:

| Feld | Wert |
| --- | --- |
| Zeilen | 10.786 |
| `grain` | `ags` |
| `geo_key` | `geo_ags` (achtstelliger AGS) |
| `ref_period` | `2022-05` |
| `embedding` | `vector(1536)`, alle NULL |

`embedding_jobs`, eine Zeile:

| `id` | `status` | `row_count` |
| --- | --- | --- |
| 1 | `pending` | 10786 |

DDL: [schema.sql](schema.sql). Refresh-Schritte: [pipeline.md](pipeline.md).

## Tabellen / Artefakte

Pipeline:

1. Supabase `scout_*` → Fact-Tabellen → `geo_ref_*` (Projekt `tyfwdjzkfvuhasnebhvo`, Schema `public`)
2. Feature-Docs in Brain-Tabelle `location_feature_docs`
3. Jobs in `embedding_jobs`
4. Similarity, sobald `embedding` gefüllt ist

| Tabelle | Ort | Zweck |
| --- | --- | --- |
| `location_feature_docs` | Brain (nicht Supabase) | eine Zeile pro Ort und Zeitraum: Text, Metadata, Quellen-Refs |
| `embedding_jobs` | Brain (nicht Supabase) | Status, Zeiten, Row-Count, Notes |

Kernfelder von `location_feature_docs`: `geo_key`, `grain` (`address`, `grid100`, `plz8`, `plz5`, `ags`, `ags5`, `other`), `ref_period`, `title`, `content`, `metadata` (jsonb), `embedding` (`vector(1536)`, nullable), `source_tables`, `supabase_synced_at`.

Eindeutigkeit: `(geo_key, grain, coalesce(ref_period, ''))` über den Index `location_feature_docs_geo_uniq`. Weitere B-Tree-Indizes auf `grain`, `geo_key` und `ref_period`.

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
| `embedding` | NULL, Job später |

Loader, Chunks und CSV liegen außerhalb des Repos: Box `/workspace/data-engineer/`, Mac `/Users/ruehrai/data-engineer/`.

## How to refresh

1. Fact-Tabellen in Supabase sind aktuell (RLS blockiert Anon-REST; Export über einen berechtigten SQL-Pfad, nicht über eingecheckte Keys).
2. Feature-Docs bauen und idempotent nach `location_feature_docs` upserten.
3. Jobzeile in `embedding_jobs` setzen. Der geladene Batch ist `id=1`, `status=pending`, `row_count=10786`.
4. CSV-Zwischendateien nicht committen. Schritte und lokale Pfade: [pipeline.md](pipeline.md).

## Open issues

- Embedding-Modell ist nicht festgelegt; `embedding` ist auf allen 10.786 Zeilen NULL. `embedding_jobs.id=1` bleibt `pending`.
- HNSW oder IVFFlat erst nach den ersten Embeddings.
- Zweiter Batch Destatis Kreis (`grain=ags5`) ist offen. Vorhanden, nicht in diesem Batch: `destatis_bevoelkerung_kreise`, `destatis_bevoelkerung_alter`, `destatis_auslaender_kreise` ([Quelle 01](../quellen-und-abrufe/quelle-01-destatis-genesis.md)).
- Feinere Grains warten auf `geo_ref_*`.
- Refresh-Cadence ist noch nicht an die Quell-Cadence gekoppelt.
- Ausführbare Loader liegen noch nicht im Repo.

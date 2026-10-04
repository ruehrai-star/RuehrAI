# Vektorisierung & Analytics

Standort-Feature-Dokumente und Embeddings liegen auf **Brain STAGE** (Eule, Postgres.app, Datenbank `Brain`). Die dauerhafte Rohablage ist **Data-Scout** (Eule, Datenbank `Data-Scout`). Brain-Pipelines lesen dort nur. Supabase `tyfwdjzkfvuhasnebhvo` ist ein transienter Pull, nicht die Quelle, aus der Brain dauerhaft liest.

**Owner:** Data-Engineer

**Confluence:** [Vektorisierung & Analytics](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/21856257)

Vertrag für Backend: [supabase-to-brain-sync.md](supabase-to-brain-sync.md). Lebender DDL-Stand: [schema.sql](schema.sql). Refresh: [pipeline.md](pipeline.md).

Dieser Stand beschreibt Brain STAGE, abgefragt 2026-10-04 gegen 10:25 Europe/Berlin. Brain PROD (Fuchs) und ein Promote nach Modell B sind nicht Teil dieses Stands.

## Status

**STAGE, 2026-10-04.** `features.location_feature_docs` hat **4.088.102** Zeilen. Davon tragen **937.816** ein Embedding. **3.150.286** Embeddings sind NULL, und zwar nur auf Gitter-Docs. Alle **139.096** Docs außerhalb der Gitter sind eingebettet (`null_emb=0`).

| Feld | Wert |
| --- | --- |
| Host | Eule, Postgres.app |
| Datenbank | `Brain` (STAGE) |
| Connect | `DATABASE_URL`, User `ruehrai`. Passwort nur im Secret-Store. |
| Lese-Rolle | `backend_ro_features` **NOLOGIN**, read-only. Nach dem Connect: `SET ROLE backend_ro_features`. |
| `embedding` | `vector(1024)`, nullable |
| Embed-API (STAGE) | Eule oMLX `http://localhost:8000/v1`, Modell `jina-embeddings-v5-text-small-retrieval-mlx-oQ8`. Kein Key in diesem Doc. |
| Vektorindex | HNSW `location_feature_docs_embedding_hnsw` (cosine), genutzt von `features.v_location_search` |
| Extensions | pgvector **0.8.6**, PostGIS **3.6.3** |

### Rollen der Systeme

| System | Rolle |
| --- | --- |
| Supabase `tyfwdjzkfvuhasnebhvo` | Transienter Pull. Nicht die dauerhafte Brain-Quelle. |
| Data-Scout (Eule, DB `Data-Scout`) | Dauerhafte Roh-Tabellen. Brain liest nur. |
| Brain STAGE (Eule, DB `Brain`) | Feature-Docs, Vektoren, Katalogspiegel `geo`, Schema `app` (Backend). |
| Brain PROD (Fuchs) | Promote Modell B nur nach ausdrücklichem Go. Nicht Gegenstand dieses Docs. |

### Schema-Split

| Schema | Owner | Zweck |
| --- | --- | --- |
| `features` | Data-Engineer | Feature-Docs, Embedding-Jobs, Search-View, HNSW |
| `app` | Backend | Backend-eigen. Lebende Tabellen sind vorhanden. DDL steht nicht in diesem Ordner. |
| `geo` | Katalogspiegel | `geo_ref_*` auf Brain, nicht die Feature-Docs. DDL steht nicht in diesem Ordner. |
| `public` | — | Hält die Feature-Docs nicht mehr (verschoben 2026-09-28). |

| Objekt | Zweck |
| --- | --- |
| `features.location_feature_docs` | Eine Zeile pro Ort, Grain und `ref_period`. `embedding vector(1024)` nullable. |
| `features.embedding_jobs` | Job-Ledger |
| `features.v_location_search` | Projektion für Backend `/search`. Spaltenliste unverändert. |

Spalten der View: `id`, `geo_key`, `grain`, `ref_period`, `name`, `title`, `lon`, `lat`, `source_theme`, `source_tables`, `metadata`, `supabase_synced_at`, `embedding`.

Eindeutigkeit: `(geo_key, grain, COALESCE(ref_period, ''))` über `location_feature_docs_geo_uniq`. Kollidierende Zeiträume tragen ein Themen-Suffix in `ref_period` (Beispiel `2025-12|bka`). Erlaubte Grains: `address`, `grid100`, `plz8`, `plz5`, `ags`, `ags5`, `other`. Weitere B-Tree-Indizes auf `grain`, `geo_key` und `ref_period`.

`backend_ro_features` ist **NOLOGIN** und bekommt kein Passwort. `USAGE` auf Schema `features`, `SELECT` auf Tabellen, Views und Sequences dort, inklusive künftiger Objekte über `ALTER DEFAULT PRIVILEGES` für `ruehrai`. Dieselbe Rolle hat `SELECT` auf den vier `geo`-Tabellen unten. `GRANT backend_ro_features TO ruehrai` erlaubt `SET ROLE` nach dem Connect über `DATABASE_URL`.

## Themen (live)

Alle Nicht-Gitter-Themen haben `null_emb=0`. Zeilenzahlen sind der Live-Stand, keine Schätzung.

### Kern / frühere Batches

| Thema | Grain | `ref_period` | Zeilen |
| --- | --- | --- | --- |
| zensus2022 | ags | 2022-05 | 10786 |
| destatis | ags5 | 2025-12 | 477 |
| wwk | ags | 2023 | 3103 |
| regionalstatistik_bevoelkerung | ags | 2025-12 | 13567 |
| regionalstatistik_wanderungen | ags | 2024 | 13567 |

### Quellen vom 2026-10-03, Vormittag

| Thema | Grain | `ref_period` | Zeilen |
| --- | --- | --- | --- |
| ba_pendler | ags / ags5 / other | 2025-06 | 10752 + 294 + 36 |
| ba_alo | ags | 2026-09 | 401 |
| bka_pks | ags / ags5 | 2025-12\|bka | 80 + 400 |
| boris_brw | ags | 2026-01 | 809 (Gemeinde-Aggregat, nicht die Zonen) |
| gerda | ags | 2025-02 | 10753 |
| bundeswahlleiter | ags | 2024-11 | 10956 |
| destatis_baugenehmigung | other | 2025\|bau | 16 |
| kmk | other | 2024\|kmk | 16 |
| kba_besitz | other | 2026-08\|kba | 17 |
| daten_bw | ags5 | 2024-06 | 44 |
| open_nrw | — | — | klein (Kleve/Neuss); keine Einzelzählung in diesem Stand |
| dehoga | other | 2026-Q1\|dehoga | 17 |
| bbsr_nuts | other | 2024\|bbsr | 456 |
| statistikportal_gv | ags | 2025-12\|gv | 10953 |

### Acht Tabellen vom 2026-10-03, Abend

Alle eingebettet.

| Thema | Grain | `ref_period` | Zeilen |
| --- | --- | --- | --- |
| zensus_gw_gebaeude | ags | 2022-05\|gw_gebaeude | 10786 |
| zensus_gw_wohnungen | ags | 2022-05\|gw_wohnungen | 10786 |
| unfallatlas | ags / ags5 | 2025\|unfallatlas | 9375 + 104 (nur Jahr 2025, nicht die Punktmenge) |
| breitband | ags | 2025-12\|breitband | 11002 (nur Gemeinde-Excel) |
| vgrdl_einkommen | ags5 | 2024\|vgrdl | 398 |
| krankenhaeuser | other | 2026-09\|kh | 1571 (BKA) |
| krankenhaeuser | other | 2024-12\|kh | 3027 (Destatis, lon 0) |
| uba_luft | other | 2025\|uba_luft | 615 |
| rwi_redx | ags | 2025-11\|rwi | 3906 |

### Gitter

Geladen. Embeddings liefen am Morgen des 2026-10-04 noch. Screen `embed_grids_b` auf Eule war detached und lief weiter.

| Thema | Grain | `ref_period` | Zeilen | embedded | NULL |
| --- | --- | --- | --- | --- | --- |
| breitband_gitter | grid100 | 2025-12\|gitter | 3.590.703 | 798.752 (22,2 %) | 2.791.951 |
| dwd_temp_1km | other | 2025\|dwd | 358.303 | 0 | 358.303 |

`breitband_gitter`: Schlüssel ist `raster_rowid`. Eine Spalte `raster_id` gibt es nicht. `geo_grid100_id` steht im Text, nicht im Schlüssel. Ein Reload des 100-m-ZIP ist nicht gelaufen.

`dwd_temp_1km`: Jahr 2025. Grad Celsius ist `value_tenth/10`. Schlüssel `dwd1km:{col}:{row}`.

## Schema `geo`

Katalogspiegel auf Brain STAGE, getrennt von den Feature-Docs. `backend_ro_features` darf diese Tabellen lesen. Das DDL der Tabellen steht nicht in diesem Ordner.

| Tabelle | Zeilen | Notiz |
| --- | --- | --- |
| `geo.geo_ref_plz` | 8175 | geom 4326 (aus 3035). Katalogschlüssel `geo_plz5`. PK `geo_plz8`. |
| `geo.geo_ref_bezirk` | 429 | geom 4326. Berlin `11000001`–`11000012`. |
| `geo.geo_ref_ortsteil` | 19781 | geom 4326 |
| `geo.geo_ref_admin` | 11356 | Namen. geom oft NULL. |

## How to refresh

1. Rohdaten aus Data-Scout lesen (read-only). Supabase nicht als dauerhafte Brain-Quelle behandeln.
2. Docs idempotent nach `features.location_feature_docs` upserten. Zeitraum-Kollisionen über das Suffix in `ref_period`.
3. Embeddings auf Eule über oMLX `http://localhost:8000/v1` nach `vector(1024)`. Der cosine-HNSW existiert bereits.
4. Backend liest `features.v_location_search` nach `SET ROLE backend_ro_features`.
5. Keine CSV und keine Credentials ins Repo. Schritte: [pipeline.md](pipeline.md).

## Open issues

- Gitter-Embeddings sind nicht fertig. `breitband_gitter`: 798.752 von 3.590.703 embedded, 2.791.951 NULL. `dwd_temp_1km`: 358.303 Zeilen, noch ohne Embedding. Screen `embed_grids_b` lief am 2026-10-04 weiter.
- Bewusst nicht geladen: `dwd_cdc_raster_catalog` (70 Dateien, keine Zellenwerte, kein Area-Key), anonymes `rwi_grid` (etwa 242.000, kein Area-Key), Reload des 100-m-Breitband-ZIP, ÖPNV-GTFS-Stops und Kataloge ohne Geo, ältere Historienperioden jenseits der gewählten `ref_period`.
- Promote nach Brain PROD (Fuchs, Modell B) wartet auf ein ausdrückliches Go und ist hier nicht beschrieben.

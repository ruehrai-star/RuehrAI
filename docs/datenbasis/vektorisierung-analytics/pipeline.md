# Pipeline — Feature-Docs nach Brain STAGE

Stand 2026-10-04, Europe/Berlin. Ziel ist Brain STAGE auf Eule (Postgres.app, Datenbank `Brain`). Narrativ bleibt in Confluence. Keine Credentials, keine CSV-Inhalte, keine Chunks in diesem Repo. Kein Schreibweg nach PROD (Fuchs).

Status und Zählung: [README.md](README.md). Lebender DDL-Stand: [schema.sql](schema.sql). Vertrag für Backend: [supabase-to-brain-sync.md](supabase-to-brain-sync.md).

## Pfad

| System | Rolle in diesem Lauf |
| --- | --- |
| Supabase `tyfwdjzkfvuhasnebhvo` | Nur transienter Pull. Nicht die dauerhafte Quelle für Brain. |
| Data-Scout (Eule, DB `Data-Scout`) | Dauerhafte Roh-Tabellen. Brain-Pipelines lesen nur. |
| Brain STAGE (Eule, DB `Brain`) | Upsert der Feature-Docs, Embeddings, View, Katalogspiegel `geo`. |
| Brain PROD (Fuchs) | Liegt außerhalb dieses Laufs. Promote Modell B nur nach ausdrücklichem Go. |

Zielobjekte: `features.location_feature_docs`, `features.embedding_jobs`, View `features.v_location_search`, Index `location_feature_docs_embedding_hnsw`. Schema `app` gehört Backend und hat bereits Tabellen; deren DDL steht nicht hier.

## Refresh

1. Rohzeilen in Data-Scout prüfen und nur lesen. Ein Supabase-Export ist ein transienter Pull, kein zweiter dauerhafter Bestand.
2. Docs bauen. Eindeutigkeit auf `(geo_key, grain, COALESCE(ref_period, ''))`. Teilen sich zwei Themen denselben Zeitraum, kommt das Thema als Suffix in `ref_period` (Beispiel `2025-12|bka`). Erlaubte Grains: `address`, `grid100`, `plz8`, `plz5`, `ags`, `ags5`, `other`.
3. Idempotent nach **`features.location_feature_docs`** auf Brain STAGE upserten (`INSERT … ON CONFLICT`). Der Loader setzt `supabase_synced_at = now()`, wo der bestehende Loader das so schreibt. Passwort von `ruehrai` nur aus dem Secret-Store. Kein Connection-String in Git.
4. Anzeigenamen, die noch leer sind und `metadata->>'gemeinde_name'` tragen, nachziehen:

```sql
UPDATE features.location_feature_docs
SET name = metadata->>'gemeinde_name'
WHERE name IS NULL AND metadata->>'gemeinde_name' IS NOT NULL;
```

5. Embeddings auf Eule über oMLX. Basis-URL `http://localhost:8000/v1`, Modell `jina-embeddings-v5-text-small-retrieval-mlx-oQ8`. Ablage ist `vector(1024)`. Ein API-Key bleibt im Secret-Store und steht nicht in diesem Doc.
6. Cosine-HNSW `location_feature_docs_embedding_hnsw` ist auf STAGE angelegt. `features.v_location_search` nutzt ihn. Die View hat keine eigene Ladelogik. Spaltenliste: `id`, `geo_key`, `grain`, `ref_period`, `name`, `title`, `lon`, `lat`, `source_theme`, `source_tables`, `metadata`, `supabase_synced_at`, `embedding`.
7. Backend liest read-only: Connect über `DATABASE_URL` als `ruehrai`, dann `SET ROLE backend_ro_features` (NOLOGIN, kein eigenes Passwort).
8. Gitter-Embeddings sind der offene Lauf. Am 2026-10-04 lief Screen `embed_grids_b` auf Eule noch (detached). `breitband_gitter` (`grid100`, `2025-12|gitter`): 3.590.703 Zeilen, 798.752 embedded (22,2 %), 2.791.951 NULL. Schlüssel `raster_rowid`. `dwd_temp_1km` (`other`, `2025|dwd`): 358.303 Zeilen, 0 embedded. Schlüssel `dwd1km:{col}:{row}`, °C = `value_tenth/10`.

CSV und Chunks nicht committen. Hilfsskripte, falls lokal vorhanden, liegen außerhalb des Repos (Box `/workspace/data-engineer/`, Mac `/Users/ruehrai/data-engineer/`), nicht in Git.

## Nicht Teil dieses Laufs

- `dwd_cdc_raster_catalog` (70 Dateien, keine Zellenwerte, kein Area-Key)
- anonymes `rwi_grid` (etwa 242.000 Zeilen, kein Area-Key)
- Reload des 100-m-Breitband-ZIP
- ÖPNV-GTFS-Stops und Kataloge ohne Geo
- ältere Historienperioden jenseits der gewählten `ref_period`
- Schreiben nach PROD oder ein Fuchs-Promote

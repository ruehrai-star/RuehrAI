# Pipeline — Feature-Docs nach Brain

Kurzskizze des ersten Loads (Stand 2026-09-28). Narrativ bleibt in Confluence. Keine Credentials, keine CSV-Inhalte, keine Chunks in diesem Repo.

Status und Zählung: [README.md](README.md). Lebender DDL-Stand: [schema.sql](schema.sql). Vertrag für Backend: [supabase-to-brain-sync.md](supabase-to-brain-sync.md).

Zielobjekte auf Brain: `features.location_feature_docs`, `features.embedding_jobs`, View `features.v_location_search`. Schema `app` bleibt leer (Backend-Platzhalter).

## Artefakte außerhalb des Repos

| Ort | Pfad |
| --- | --- |
| Shared box | `/workspace/data-engineer/` |
| RuehrAI Mac | `/Users/ruehrai/data-engineer/` |

Dort, nicht hier: Join-Template (`scripts/zensus_join_query.sql`), Chunk-Helfer (`scripts/extract_mcp_chunk.py`), Builder (`scripts/build_location_feature_docs.py`), Loader (`scripts/load_to_brain.sh`), Features-Migration (`scripts/03_features_schema.sql`). Die Mac-Kopie des ersten Loads liegt unter `/Users/ruehrai/data-engineer/data/location_feature_docs.csv` und `/Users/ruehrai/data-engineer/scripts/load_to_brain.sh`. CSV und `data/chunks/` nicht committen.

## Refresh

1. Fact-Tabellen im Supabase-Projekt `tyfwdjzkfvuhasnebhvo` prüfen. Anon-REST liest sie nicht (RLS). Export über privilegiertes SQL, MCP `execute_sql`, in Chunks (`LIMIT` / `OFFSET`). Keys bleiben im Secret-Store.
2. Join: Basis `zensus2022_demografie_gemeinden`, `LEFT JOIN` der fünf weiteren Zensus-Gemeinde-Tabellen auf `geo_ags` und `ref_period`, `ORDER BY geo_ags`. Chunk-Dateien lokal unter `data/chunks/`.
3. Deutschen Fließtext und `metadata` bauen (`scripts/build_location_feature_docs.py`). Zwischen-CSV nicht ins Repo.
4. CSV auf den Mac kopieren und mit `scripts/load_to_brain.sh` laden: Temp-Tabelle, `\copy`, `INSERT … ON CONFLICT` nach **`features.location_feature_docs`** auf `(geo_key, grain, coalesce(ref_period, ''))`. Der Loader setzt `supabase_synced_at = now()`. Passwort der Rolle `ruehrai` nur aus dem Secret-Store; kein Connection-String in Git. Backend liest danach read-only: Connect über `DATABASE_URL`, dann `SET ROLE backend_ro_features` (NOLOGIN, kein eigenes Passwort).
5. Display-Name nachziehen, wo er leer ist:

```sql
UPDATE features.location_feature_docs
SET name = metadata->>'gemeinde_name'
WHERE name IS NULL AND metadata->>'gemeinde_name' IS NOT NULL;
```

`lon`, `lat` und `source_theme` bleiben NULL, bis eine spätere Anreicherung sie füllt. `features.v_location_search` ist eine View auf die Docs und braucht keinen eigenen Load.

6. Zeile in `features.embedding_jobs` prüfen. Nach dem ersten Load: `id=1`, `status=pending`, `row_count=10786`. Der Embedding-Lauf ist nicht gestartet.
7. `embedding` auf `features.location_feature_docs` und einen HNSW- oder IVFFlat-Index erst anlegen, wenn das Modell festliegt.

Der Upsert der Feature-Docs ist idempotent auf `(geo_key, grain, coalesce(ref_period, ''))`. Der erste Load hat genau eine Jobzeile geschrieben (`id=1`, `status=pending`, `row_count=10786`) und 10.786 Zensus-`ags`-Docs. `name` ist auf allen 10.786 Zeilen gefüllt; `lon`, `lat`, `source_theme` und `embedding` sind NULL.

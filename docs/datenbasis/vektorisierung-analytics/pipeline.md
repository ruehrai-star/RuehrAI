# Pipeline — Feature-Docs nach Brain

Kurzskizze des ersten Loads (Stand 2026-09-28). Narrativ bleibt in Confluence. Keine Credentials, keine CSV-Inhalte, keine Chunks in diesem Repo.

Status und Zählung: [README.md](README.md). DDL: [schema.sql](schema.sql).

## Artefakte außerhalb des Repos

| Ort | Pfad |
| --- | --- |
| Shared box | `/workspace/data-engineer/` |
| RuehrAI Mac | `/Users/ruehrai/data-engineer/` |

Dort, nicht hier: Join-Template (`scripts/zensus_join_query.sql`), Chunk-Helfer (`scripts/extract_mcp_chunk.py`), Builder (`scripts/build_location_feature_docs.py`), Loader (`scripts/load_to_brain.sh`). Die Mac-Kopie des ersten Loads liegt unter `/Users/ruehrai/data-engineer/data/location_feature_docs.csv` und `/Users/ruehrai/data-engineer/scripts/load_to_brain.sh`. CSV und `data/chunks/` nicht committen.

## Refresh

1. Fact-Tabellen im Supabase-Projekt `tyfwdjzkfvuhasnebhvo` prüfen. Anon-REST liest sie nicht (RLS). Export über privilegiertes SQL, MCP `execute_sql`, in Chunks (`LIMIT` / `OFFSET`). Keys bleiben im Secret-Store.
2. Join: Basis `zensus2022_demografie_gemeinden`, `LEFT JOIN` der fünf weiteren Zensus-Gemeinde-Tabellen auf `geo_ags` und `ref_period`, `ORDER BY geo_ags`. Chunk-Dateien lokal unter `data/chunks/`.
3. Deutschen Fließtext und `metadata` bauen (`scripts/build_location_feature_docs.py`). Zwischen-CSV nicht ins Repo.
4. CSV auf den Mac kopieren und mit `scripts/load_to_brain.sh` laden: Temp-Tabelle, `\copy`, `INSERT … ON CONFLICT` auf `(geo_key, grain, coalesce(ref_period, ''))`. Der Loader setzt `supabase_synced_at = now()`. Passwort der Rolle `ruehrai` nur aus dem Secret-Store; kein Connection-String in Git.
5. Zeile in `embedding_jobs` prüfen. Nach dem ersten Load: `id=1`, `status=pending`, `row_count=10786`. Der Embedding-Lauf ist nicht gestartet.
6. `embedding` und einen HNSW- oder IVFFlat-Index erst anlegen, wenn das Modell festliegt.

Der Upsert der Feature-Docs ist idempotent auf `(geo_key, grain, coalesce(ref_period, ''))`. Der erste Load hat genau eine Jobzeile geschrieben (`id=1`, `status=pending`, `row_count=10786`).

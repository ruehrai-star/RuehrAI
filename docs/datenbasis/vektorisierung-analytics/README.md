# Vektorisierung & Analytics

Aus Supabase-Facts und `geo_ref_*` werden Standort-Feature-Dokumente und später Embeddings. Supabase bleibt die relationale Quelle. Die Vektorablage ist die lokale Datenbank **Brain** (Postgres + pgvector), nicht ein zweites Supabase-Projekt.

**Owner:** Data-Engineer

**Confluence:** [Vektorisierung & Analytics](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/21856257)

## Status

Skeleton für die Pipeline. Der erste Feature-Doc-Batch (Zensus-Gemeinden) ist in Confluence beschrieben; Embeddings sind noch leer. Verbindungsdaten zur lokalen Brain-Instanz nur im Secret-Store.

## Tabellen / Artefakte

Pipeline:

1. Supabase `scout_*` → Fact-Tabellen → `geo_ref_*` (Projekt `tyfwdjzkfvuhasnebhvo`)
2. Feature-Docs in Brain-Tabelle `location_feature_docs`
3. Jobs in `embedding_jobs`
4. Similarity, sobald `embedding` gefüllt ist

| Tabelle | Ort | Zweck |
| --- | --- | --- |
| `location_feature_docs` | Brain | eine Zeile pro Ort und Zeitraum: Text, Metadata, Quellen-Refs |
| `embedding_jobs` | Brain | Status, Zeiten, Row-Count, Notes |

Kernfelder von `location_feature_docs`: `geo_key`, `grain` (`address`, `grid100`, `plz8`, `plz5`, `ags`, `ags5`, `other`), `ref_period`, `title`, `content`, `metadata` (jsonb), `embedding` (`vector(1536)`, nullable), `source_tables`, `supabase_synced_at`.

Eindeutigkeit: `(geo_key, grain, coalesce(ref_period, ''))`.

Erster Batch, Quellen in Supabase (Join über `geo_ags` und `ref_period`):

- `zensus2022_demografie_gemeinden`
- `zensus2022_bevoelkerung_gemeinden`
- `zensus2022_haushalte_gemeinden`
- `zensus2022_wohnungen_gemeinden`
- `zensus2022_erwerbsstatus_gemeinden`
- `zensus2022_gebaeude_gemeinden`

Grain dieses Batches: `ags`. `ref_period`: `2022-05`.

Extension: `pgvector`. Index (HNSW oder IVFFlat) erst nach den ersten Embeddings.

## How to refresh

1. Fact-Tabellen in Supabase sind aktuell (RLS blockiert Anon-REST; Export über einen berechtigten SQL-Pfad, nicht über eingecheckte Keys).
2. Feature-Docs bauen und idempotent nach `location_feature_docs` upserten.
3. Jobzeile in `embedding_jobs` setzen.
4. CSV-Zwischendateien nicht committen. Skripte können später unter einem eigenen Pfad landen; dieses Skeleton enthält sie nicht.

## Open issues

- Embedding-Modell ist nicht festgelegt; Spalte `embedding` bleibt NULL.
- Zweiter Batch Destatis Kreis (`ags5`) ist offen.
- Feinere Grains warten auf `geo_ref_*`.
- Refresh-Cadence ist noch nicht an die Quell-Cadence gekoppelt.

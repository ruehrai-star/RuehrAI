# Quellen & Abrufe

Inventar der Datenquellen 01–10. Jede Quelle hat ein Stub mit Source-ID, Access-Typ, Grain und bekannten Supabase-Tabellen. Abruf-Narrativ, Zeilenzahlen und `scout_pull_run`-IDs bleiben auf der Confluence-Kindseite.

**Owner:** Data-Scout

**Confluence:** [Quellen & Abrufe](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/21757953)

Access-Typen: `OPEN` (kein Login) und `REG` (Registrierung; Secrets nur im Secret-Store).

## Status

Technischer Stand der Scout-Pulls **2026-09-28**. Zeilenzahlen und `scout_pull_run`-IDs bleiben in Confluence. Weitere Pulls sind nach Quelle 10 pausiert; Fortsetzung ab Quelle 11 nach CTO-Go.

| # | Stub | Source-ID | Access | Grain | Status |
| --- | --- | --- | --- | --- | --- |
| 01 | [Destatis GENESIS](quelle-01-destatis-genesis.md) | `destatis-genesis` | `REG` | `ags5` | ok |
| 02 | [Zensus 2022](quelle-02-zensus-2022.md) | `zensus-2022-db` | `REG` / Download | `ags` | ok (Regionaltabellen-Fallback) |
| 03 | [Regionalstatistik](quelle-03-regionalstatistik.md) | `regionalstatistik` | `REG` | `ags` (Ziel) | **blocked (Auth)** |
| 04 | [KBA](quelle-04-kba.md) | `kba-open` | `OPEN` | Land / `ags5` | ok |
| 05 | [Mobilithek](quelle-05-mobilithek.md) | `mobilithek` | `OPEN` | `ags` / other | ok |
| 06 | [GTFS Deutschland](quelle-06-gtfs-deutschland.md) | `gtfs-deutschland` | `OPEN` | other | ok |
| 07 | [Wegweiser Kommune](quelle-07-wegweiser-kommune.md) | `wegweiser-kommune` | `OPEN` | `ags` | ok |
| 08 | [Wegweiser Kommune API](quelle-08-wegweiser-kommune-api.md) | `wegweiser-kommune-api` | `OPEN` | `ags` | ok (Inventar-Twin) |
| 09 | [OSM](quelle-09-osm.md) | `osm-overpass` | `OPEN` | address / `plz5` / other | ok (nur Berlin) |
| 10 | [GovData](quelle-10-govdata.md) | `govdata` | `OPEN` | `ags` / other | ok |

## Tabellen / Artefakte

Fact-Tabellen folgen `{quelle}_{thema}_{grain}` im Schema `public`. Metadaten: `scout_source`, `scout_pull_run`. Keine Rohdateien in diesem Ordner.

## How to refresh

1. Eintrag in `scout_source` prüfen (`source_id`, `access_type`, Grain, URL).
2. Pull ausführen; Lauf in `scout_pull_run` protokollieren. Credentials nur aus dem Secret-Store.
3. Fact-Tabellen laden und RLS laut [Supabase-Schema](../supabase-schema/README.md) setzen.
4. Confluence-Kindseite und das passende Stub aktualisieren, wenn Tabellen dazukommen oder wegfallen.

Neues-Quelle-Runbook: [Runbooks](../runbooks/README.md).

## Open issues

- Scout-Pulls sind nach Quelle 10 pausiert. Resume ab Quelle 11 nach CTO-Go.
- Quelle 03 (`regionalstatistik`) ist **blocked (Auth)**; null Fact-Tabellen, bis der Operator das REG-Passwort zurücksetzt oder ein neues Konto anlegt.
- Quelle 08 dupliziert die Indikatoren aus Quelle 07 nicht; OpenAPI bleibt Inventar (`row_count` 0 by design).
- Frühere Staging-Loads (zum Beispiel `ba-sgb2`, `zensus-2022-grid`) sind keine Kindseiten 01–10. Details nur in Confluence.

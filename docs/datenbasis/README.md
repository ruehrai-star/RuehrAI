# Datenbasis — Überblick

Technisches Inhaltsverzeichnis der RuehrAI-Datenbasis in diesem Repo. Onboarding-Narrativ, Pull-Historie und Zeilenzahlen bleiben in Confluence. Hier liegen Struktur, Identifikatoren und Platzhalter für Artefakte — ohne Secrets und ohne Rohdaten.

**Owner:** Data-Scout, Location-Guide, Data-Engineer

**Confluence:** [Datenbasis — Überblick](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/21725185)

Ordner in Confluence: [Datenbasis](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/folder/655362/Datenbasis)

## Geschwister

| Bereich | Repo | Confluence | Owner |
| --- | --- | --- | --- |
| Quellen & Abrufe | [quellen-und-abrufe/](quellen-und-abrufe/README.md) | [21757953](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/21757953) | Data-Scout |
| Supabase-Schema | [supabase-schema/](supabase-schema/README.md) | [21790721](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/21790721) | Data-Engineer |
| Geo & Spatial | [geo-spatial/](geo-spatial/README.md) | [21823489](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/21823489) | Location-Guide |
| Vektorisierung & Analytics | [vektorisierung-analytics/](vektorisierung-analytics/README.md) | [21856257](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/21856257) | Data-Engineer |
| Runbooks | [runbooks/](runbooks/README.md) | [21889025](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/21889025) | Data-Scout, Location-Guide, Data-Engineer |

## Status

Skeleton. Aktuellen Plattformstand (welche Quelle `ok` oder `blocked` ist) in Confluence pflegen und hier nur nachziehen, wenn sich Tabellen oder Pfade ändern.

Bekannte Ausnahme im Inventar: [Quelle 03 Regionalstatistik](quellen-und-abrufe/quelle-03-regionalstatistik.md) ist **blocked (Auth)** — noch keine Fact-Tabellen.

## Tabellen / Artefakte

Schichten (Namenskonvention im [Supabase-Schema](supabase-schema/README.md)):

1. `scout_*` — Inventar und Pull-Runs
2. `{quelle}_{thema}_{grain}` — Fact-Tabellen je Quelle
3. `geo_ref_*` — räumliche Referenz
4. Brain (`location_feature_docs`, `embedding_jobs`) — Feature-Docs und Embedding-Jobs, getrennt von Supabase

Projekt-Ref (kein Secret): `tyfwdjzkfvuhasnebhvo`, Schema `public`.

## How to refresh

1. Narrativ und Checklisten in der verlinkten Confluence-Seite lesen.
2. Technische Änderung (neue Tabelle, neuer Pfad, neues Runbook) in dem passenden Ordner unter `docs/datenbasis/` eintragen.
3. Keine Credentials, CSV-Inhalte oder `scout_pull_run`-IDs in Git ablegen.

## Open issues

- Skeleton enthält noch keine SQL-Migrationen, Loader oder Refresh-Skripte.
- Live-Status und Row-Counts stehen nur in Confluence, bis ein automatisierter Export ohne Secrets vereinbart ist.

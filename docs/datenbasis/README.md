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

Quellen-Stubs 01–10 in [Quellen & Abrufe](quellen-und-abrufe/README.md) tragen den technischen Stand **2026-09-28** (`ok`, `blocked`, `limited`). Narrativ, Zeilenzahlen und `scout_pull_run`-IDs bleiben in Confluence. Geo & Spatial und Vektorisierung & Analytics sind weiter Skeletons.

[Quelle 03 Regionalstatistik](quellen-und-abrufe/quelle-03-regionalstatistik.md) ist **blocked (Auth)** — noch keine Fact-Tabellen. Scout-Pulls sind nach Quelle 10 pausiert (Fortsetzung ab 11 nach CTO-Go).

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
- Zeilenzahlen und `scout_pull_run`-IDs stehen nur in Confluence. Der technische Status der Quellen 01–10 steht in den Stubs.

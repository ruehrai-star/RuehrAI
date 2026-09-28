# RuehrAI

Standortberatung mit kleinräumigen Deutschland-Daten.

## Dokumentation

- **Onboarding (narrativ):** Confluence-Space [Datenbasis](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/folder/655362/Datenbasis)
- **Technische Artefakte:** [`docs/datenbasis/`](docs/datenbasis/README.md) — Struktur und Identifikatoren; Pull-Narrativ bleibt in Confluence
  - [`quellen-und-abrufe/`](docs/datenbasis/quellen-und-abrufe/README.md)
  - [`supabase-schema/`](docs/datenbasis/supabase-schema/README.md)
  - [`geo-spatial/`](docs/datenbasis/geo-spatial/README.md)
  - [`vektorisierung-analytics/`](docs/datenbasis/vektorisierung-analytics/README.md)
  - [`runbooks/`](docs/datenbasis/runbooks/README.md)

## Data-Team

| Rolle | Aufgabe |
| --- | --- |
| Data-Scout | Quellen finden, Abrufe, Qualität, Speicherung in Supabase |
| Location-Guide | Kleinräumige Zuordnung, Gebietsdefinitionen, Kartenlagen |
| Data-Engineer | Supabase → Vektor-DB für Business-Cases |

## Datenpolitik

Nur öffentlich zugängliche oder mit Registrierung nutzbare Quellen. Keine illegalen oder nicht lizenzierten Daten.

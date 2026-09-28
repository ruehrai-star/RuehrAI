# RuehrAI

Standortberatung mit kleinräumigen Deutschland-Daten.

## Anwendungen

| Pfad | Rolle |
| --- | --- |
| [`apps/backend`](apps/backend/README.md) | NestJS-API. Auth (JWT) und Daten laufen über lokale Postgres (`DATABASE_URL`). |
| [`packages/api-contracts`](packages/api-contracts/README.md) | OpenAPI v0. Clients binden diesen Vertrag. |

Lokaler Start: [`docker-compose.yml`](docker-compose.yml) hochfahren, dann `pnpm install`, `pnpm db:migrate`, `pnpm start:dev`. Basis-URL lokal `http://localhost:3000` (`PORT`). Ablauf steht in der [Backend-README](apps/backend/README.md).

## Dokumentation

- **Onboarding (narrativ):** Confluence-Space [Datenbasis](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/folder/655362/Datenbasis)
- **Technische Artefakte:** [`docs/datenbasis/`](docs/datenbasis/README.md) — Struktur und Identifikatoren; Pull-Narrativ bleibt in Confluence
  - [`quellen-und-abrufe/`](docs/datenbasis/quellen-und-abrufe/README.md)
  - [`supabase-schema/`](docs/datenbasis/supabase-schema/README.md)
  - [`geo-spatial/`](docs/datenbasis/geo-spatial/README.md)
  - [`vektorisierung-analytics/`](docs/datenbasis/vektorisierung-analytics/README.md)
  - [`runbooks/`](docs/datenbasis/runbooks/README.md)

## Clients

Native Clients sprechen nur mit dem Backend, nicht mit Supabase.

- **iOS:** [`apps/ios`](apps/ios/README.md) — SwiftUI-Shell (iOS 17+, MapLibre, Mock-API). Projekt per XcodeGen auf einem Mac öffnen.

## Data-Team

| Rolle | Aufgabe |
| --- | --- |
| Data-Scout | Quellen finden, Abrufe, Qualität, Speicherung in Supabase |
| Location-Guide | Kleinräumige Zuordnung, Gebietsdefinitionen, Kartenlagen |
| Data-Engineer | Supabase → Vektor-DB für Business-Cases |

## Datenpolitik

Nur öffentlich zugängliche oder mit Registrierung nutzbare Quellen. Keine illegalen oder nicht lizenzierten Daten.

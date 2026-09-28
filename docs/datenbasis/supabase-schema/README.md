# Supabase-Schema

Zentrale relationale Speicherschicht. Dieses Stub nennt Projekt, RLS-Muster und Namenskonventionen. DDL, Row-Counts und Keys bleiben außerhalb von Git.

**Owner:** Data-Engineer

**Confluence:** [Supabase-Schema](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/21790721)

| Feld | Wert |
| --- | --- |
| Projekt | RuehrAI |
| Project Ref | `tyfwdjzkfvuhasnebhvo` |
| Schema | `public` |

Service-Role-Key, DB-Passwort und API-Keys nur im Secret-Store oder in CI-Env.

## Status

Konventionen sind beschrieben; ein versioniertes Migrationsverzeichnis liegt in diesem Repo noch nicht. Live-Schema im Supabase-Dashboard bzw. über die Quellenseiten prüfen.

## Tabellen / Artefakte

| Präfix | Bedeutung | Beispiele |
| --- | --- | --- |
| `scout_*` | Inventar und Staging | `scout_source`, `scout_pull_run`, `scout_fact_staging` |
| `geo_ref_*` | räumliche Referenz | siehe [Geo & Spatial](../geo-spatial/README.md) |
| `{quelle}_{thema}_{grain}` | Fact-Tabellen | `destatis_bevoelkerung_kreise`, `zensus2022_haushalte_gemeinden`, `kba_neuzulassungen_laender` |

Grain-Suffixe: `_kreise`, `_gemeinden`, `_laender`. Adresse und Grid zusätzlich als Spalten, nicht nur als Suffix.

RLS auf Fact- und Geo-Tabellen: Policy `service_role_all` für Rolle `service_role`, Befehl `*`. Anon- und Authenticated-Clients lesen Fact-Tabellen nicht direkt. Neue Tabellen bekommen dieselbe Policy.

Schichten: Scout → Fact → Geo → Analytics/Vektoren ([Vektorisierung](../vektorisierung-analytics/README.md)).

## How to refresh

1. Schema-Änderung als Migration entwerfen (noch nicht in diesem Skeleton).
2. RLS und `service_role_all` im selben Schritt anlegen.
3. Tabellenname ins passende Quellen-Stub eintragen.
4. Confluence-Seite nur um Namen und Konventionen ergänzen, nie um Secrets.

## Open issues

- Kein SQL-Migrationsordner im Repo.
- Einzelne ältere Tabellen können in Confluence noch als „RLS aus“ notiert sein; der Standard für neue public-Tabellen bleibt `service_role_all`.
- Analytics-Views sind noch nicht angelegt.

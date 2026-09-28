# Geo & Spatial

Räumliche Referenz, Joins und Kartenschlüssel für die Standortberatung. Facts tragen Grain und IDs; Geometrien leben in `geo_ref_*`.

**Owner:** Location-Guide

**Confluence:** [Geo & Spatial](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/21823489)

| Feld | Wert |
| --- | --- |
| Projekt | RuehrAI |
| Project Ref | `tyfwdjzkfvuhasnebhvo` |
| Region | `eu-central-1` |
| Schema | `public` |
| PostGIS | aktiv |
| Stand | 2026-09-28 |

Narrativ und Onboarding bleiben auf der Confluence-Seite. Hier stehen IDs, Tabellen, CRS, Konventionen und der Füllstand. `scout_pull_run`-IDs, Credentials und Geometrie-Dumps bleiben außerhalb von Git.

## Status

Spatial-Standard ist festgeschrieben. Stand **2026-09-28**: Admin, PLZ5, Berlin-Adressen und die Smoke-Crosswalks sind geladen. `geo_ref_grid100` bleibt der Zensus-2022-100-m-Smoke: 50000 Zellen im südlichen Band, ungefähr lon 7.5–13.1 / lat 47.3–47.7. Jede Zelle hat ein Polygon in EPSG:3035 und einen Centroid (`centroid_lon`, `centroid_lat`) in EPSG:4326.

| Tabelle | Zeilen | Füllung |
| --- | --- | --- |
| `geo_ref_admin` | 11356 | `gemeinde` 10939, `kreis` 401, `land` 16 |
| `geo_ref_plz` | 8175 | PLZ5-Flächen. PK `geo_plz8` spiegelt `geo_plz5`. `attrs.grain` = `plz5` |
| `geo_ref_grid100` | 50000 | Smoke. `geo_ags` auf 49952, `geo_plz5` auf 49962 |
| `geo_ref_address` | 510721 | Berlin, OSM Geofabrik |
| `geo_ref_crosswalk` | 99914 | `grid100`→`ags` 49952 + `grid100`→`plz5` 49962 |

Quellen:

| Tabelle | Quelle | Lizenz |
| --- | --- | --- |
| `geo_ref_admin` | BKG VG250, Ebenenstand 01.01.2026 (`utm32s.gpkg`) | dl-de/by-2-0, © GeoBasis-DE / BKG |
| `geo_ref_plz` | [yetzt/postleitzahlen](https://github.com/yetzt/postleitzahlen/releases/download/2026.02/postleitzahlen.geojson.br) Release 2026.02, Datei `postleitzahlen.geojson.br` (veröffentlicht 2026-02-20 UTC, geladen 2026-09-28 CEST) | ODbL-1.0, © OpenStreetMap contributors / yetzt |
| `geo_ref_grid100` | Zensus 2022, 100-m-Smoke (Pre-List-Load `zensus-2022-grid`) | siehe [Quelle 02](../quellen-und-abrufe/quelle-02-zensus-2022.md) |
| `geo_ref_address` | Geofabrik `berlin-latest.osm.pbf`, Stand 2026-09-27 | ODbL |

PLZ-Geometrie: 8176 Roh-Features, 8175 eindeutige PLZ5 (doppelte `75378` vereinigt). `geom` ist `MultiPolygon` in EPSG:3035, vereinfacht auf 25 m. `centroid_lon` / `centroid_lat` sind WGS84. `geo_plz8` ist gleich `geo_plz5`. `geo_ags`, `geo_ags5` und `geo_land` stehen auf allen 8175 Zeilen (Centroid bzw. Point-on-Surface in der Gemeinde).

Geladene PLZ-Datei ist das yetzt-Release oben. `https://downloads.suche-postleitzahl.org/v2/public/plz-5stellig.geojson` und das zugehörige TopoJSON antworteten nicht (DNS/Origin, curl exit 6). Ein Wayback-Salvage derselben Quelle hatte etwa 465 Features und wurde durch Release 2026.02 ersetzt.

Gitter-Anreicherung der 50000 Smoke-Zellen, Join in EPSG:3035:

- `geo_ags`, `geo_ags5`, `geo_land`: 49952 von 50000 über Centroid-in-Gemeinde.
- `geo_plz5`, `geo_plz8`: 49962 von 50000 über `ST_Contains` gegen den vollen PLZ5-Bestand. 38 Zellen ohne Polygon-Treffer (Rand). `geo_plz8` trägt dort dieselbe PLZ5.

Crosswalk, `method` = `centroid_in_polygon`:

- `grid100` → `ags`: 49952
- `grid100` → `plz5`: 49962 (die vorherigen 1191 PLZ-Zeilen wurden gelöscht und aus den Gitter-Attributen neu geschrieben)
- Summe 99914

## Tabellen / Artefakte

Verbindliche Regeln:

| Regel | Festlegung |
| --- | --- |
| Default-Grain | `grid100` |
| Adresse | nur mit echter Quellenadresse (`geo_addr_id`) |
| Fallback ohne Gitter | `plz8` → `plz5` → `ags` (Gemeinde) |
| Fehlende Feinheit | `null`, nicht raten |

Fact- und Staging-Zeilen tragen zusätzlich `grain`, `ref_period` (`YYYY-MM`) und `source_id` / `source_name`.

Grain-Werte wie in `scout_fact_staging.grain`: `address`, `grid100`, `plz8`, `plz5`, `ags`, `other`. Dieselbe Liste gilt für `geo_ref_crosswalk.from_grain` und `to_grain`.

| Feld | Bedeutung |
| --- | --- |
| `geo_grid100_id` | Primär. Zensus/INSPIRE `CRS3035RES100mN{northing}E{easting}`: Südwest-Ecke in Metern, EPSG:3035. `{northing}` = `y_laea`, `{easting}` = `x_laea` |
| `geo_addr_id` | `PLZ\|ORT\|STRASSE\|HNR\|ZUSATZ`, nur wenn die Quelle eine Adresse hat |
| `geo_plz8`, `geo_plz5` | PLZ8 bzw. fünfstellige PLZ. Im geladenen `geo_ref_plz` spiegelt `geo_plz8` die PLZ5 (Länge 5); `attrs.grain` = `plz5` |
| `geo_ags` | achtstelliger Amtlicher Gemeindeschlüssel auf Facts |
| `geo_ags5`, `geo_land` | Kreis (5) bzw. Land (2), auf Facts optional |
| `lon`, `lat` | WGS84 / EPSG:4326, nur wenn geocodiert |

CRS: Punkte und Adress-`geom` EPSG:4326. Polygone für Admin, PLZ und 100-m-Gitter EPSG:3035. Joins von Facts und von `scout_fact_staging` auf `geo_ref_*` laufen über diese Text-IDs, noch ohne Foreign Keys.

| Tabelle | Primary Key | Geometrie | Stand 2026-09-28 |
| --- | --- | --- | --- |
| `geo_ref_grid100` | `geo_grid100_id` | `Polygon` 3035; Centroid lon/lat 4326 | 50000 Smoke-Zellen. `geo_ags` 49952, `geo_plz5`/`geo_plz8` 49962 |
| `geo_ref_admin` | `geo_ags` | `MultiPolygon` 3035 | 11356. `level`: `gemeinde` 10939, `kreis` 401, `land` 16. BKG VG250 01.01.2026, dl-de/by-2-0 |
| `geo_ref_plz` | `geo_plz8` | `MultiPolygon` 3035 | 8175 PLZ5. PK `geo_plz8` = `geo_plz5`. `attrs.grain` = `plz5`. AGS auf allen 8175 |
| `geo_ref_address` | `geo_addr_id` | `Point` 4326 | 510721 Berlin, Geofabrik `berlin-latest` Stand 2026-09-27, ODbL. `geocode_quality` optional |
| `geo_ref_crosswalk` | `id` | — | 99914. `grid100`→`ags` 49952 und `grid100`→`plz5` 49962, `method` = `centroid_in_polygon` |

Checks, die beim Laden gelten:

- `geo_ref_admin.geo_ags` hat Länge 8 bei `gemeinde`, 5 bei `kreis` und 2 bei `land`. `name` und `geo_land` sind Pflicht.
- `geo_ref_plz.geo_plz8` hat Länge 5–8, `geo_plz5` Länge 5. Der aktuelle Bestand nutzt Länge 5, weil der PK die PLZ5 spiegelt.
- `geo_ref_address.geocode_quality` ist leer oder einer von `exact`, `interpolated`, `street`, `locality`, `failed`.
- `geo_ref_crosswalk.weight` liegt in (0, 1], Default 1. Eindeutig über (`from_grain`, `from_id`, `to_grain`, `to_id`, `method`). `method` ist optional. Die geladenen Zeilen setzen `method` = `centroid_in_polygon`.

Alle fünf Tabellen haben `attrs` (jsonb, Default `{}`) und `updated_at`. RLS: Policy `service_role_all` für Rolle `service_role`, Befehl `ALL`. Siehe [Supabase-Schema](../supabase-schema/README.md).

`scout_fact_staging` hat die `geo_*`-ID-Spalten und `grain`. Die `scout_*`-Doku gehört nicht zum Location-Guide.

Der Smoke ist der Pre-List-Load `zensus-2022-grid`. Die Gemeinde-Facts von [Quelle 02](../quellen-und-abrufe/quelle-02-zensus-2022.md) (`zensus-2022-db`, Grain `ags`, `ref_period` `2022-05`) bleiben davon getrennt; das 100-m-Gitter liegt in `geo_ref_grid100`.

## How to refresh

1. Neue Zellen oder Grenzen nur aus einer veröffentlichten Geometrie laden.
2. `geo_grid100_id` aus der Südwest-Ecke in EPSG:3035 setzen (`CRS3035RES100mN{northing}E{easting}`). IDs, die die Quelle nicht hergibt, bleiben `null`.
3. ID-Spalten und `grain` setzt der Data-Scout auf dem Pull. Nichtstandard-Gitter und proprietäre Area-Codes an den Location-Guide.
4. PLZ und AGS auf `geo_ref_grid100` über Centroid-in-Polygon in EPSG:3035 nachziehen, wenn sich Admin- oder PLZ-Grenzen ändern. Auf dem Smoke stehen `geo_ags` auf 49952 und `geo_plz5`/`geo_plz8` auf 49962 Zellen. Zellen ohne Treffer behalten `null`.
5. Crosswalk `grid100`→`ags` und `grid100`→`plz5` mit `method` `centroid_in_polygon` halten. Gewichte dokumentieren, bevor Analytics sie nutzt. Adresse↔`grid100` erst, wenn sich die Abdeckungen überlappen.
6. Policy `service_role_all` beibehalten. Keine Credentials, keine CSV-Dumps, keine Grenzdateien und keine `scout_pull_run`-IDs in Git.

## Open issues

- Echte PLZ8 (Infas, kommerziell) nur auf Auftrag. Bis dahin spiegelt der PK `geo_plz8` die PLZ5, und `attrs.grain` bleibt `plz5`.
- Flächendeckendes 100-m-Gitter über das südliche Smoke-Band (50000 Zellen) hinaus.
- Bundesweite Adressen. Geladen sind 510721 Punkte aus dem Berliner Geofabrik-Extract (Stand 2026-09-27).
- Join Adresse ↔ `grid100`: der Smoke liegt im südlichen Band, Berlin liegt außerhalb. Der Join ist deshalb ausgesetzt.

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

Narrativ und Onboarding bleiben auf der Confluence-Seite. Hier stehen IDs, Tabellen, CRS und Konventionen. Pull-IDs und laufende Zeilenzahlen bleiben in Confluence.

## Status

Spatial-Standard ist festgeschrieben. `geo_ref_grid100` ist aus einem Zensus-2022-100-m-Smoke geseedet: etwa 50.000 Zellen im südlichen Band, ungefähr lon 7.5–13.1 / lat 47.3–47.7. Jede dieser Zellen hat ein Polygon in EPSG:3035 und einen Centroid (`centroid_lon`, `centroid_lat`) in EPSG:4326. `geo_plz8`, `geo_plz5` und `geo_ags` sind auf diesem Seed leer.

`geo_ref_admin`, `geo_ref_plz`, `geo_ref_address` und `geo_ref_crosswalk` sind angelegt und leer. Weitere Gitterzellen folgen, sobald flächendeckende Pulls wieder laufen.

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
| `geo_plz8`, `geo_plz5` | PLZ8 bzw. fünfstellige PLZ |
| `geo_ags` | achtstelliger Amtlicher Gemeindeschlüssel auf Facts |
| `geo_ags5`, `geo_land` | Kreis (5) bzw. Land (2), auf Facts optional |
| `lon`, `lat` | WGS84 / EPSG:4326, nur wenn geocodiert |

CRS: Punkte und Adress-`geom` EPSG:4326. Polygone für Admin, PLZ und 100-m-Gitter EPSG:3035. Joins von Facts und von `scout_fact_staging` auf `geo_ref_*` laufen über diese Text-IDs, noch ohne Foreign Keys.

| Tabelle | Primary Key | Geometrie | Stand |
| --- | --- | --- | --- |
| `geo_ref_grid100` | `geo_grid100_id` | `Polygon` 3035; Centroid lon/lat 4326 | Smoke, etwa 50.000 Zellen; optionale PLZ/AGS leer |
| `geo_ref_admin` | `geo_ags` | `MultiPolygon` 3035 | leer. `level`: `gemeinde` \| `kreis` \| `land` |
| `geo_ref_plz` | `geo_plz8` | `MultiPolygon` 3035 | leer. `geo_plz5` Pflicht, AGS optional |
| `geo_ref_address` | `geo_addr_id` | `Point` 4326 | leer. `geocode_quality` optional |
| `geo_ref_crosswalk` | `id` | — | leer. `from_grain` / `from_id` → `to_grain` / `to_id`, `weight` |

Checks, die beim Laden gelten:

- `geo_ref_admin.geo_ags` hat Länge 8 bei `gemeinde`, 5 bei `kreis` und 2 bei `land`. `name` und `geo_land` sind Pflicht.
- `geo_ref_plz.geo_plz8` hat Länge 5–8, `geo_plz5` Länge 5.
- `geo_ref_address.geocode_quality` ist leer oder einer von `exact`, `interpolated`, `street`, `locality`, `failed`.
- `geo_ref_crosswalk.weight` liegt in (0, 1], Default 1. Eindeutig über (`from_grain`, `from_id`, `to_grain`, `to_id`, `method`). `method` ist optional.

Alle fünf Tabellen haben `attrs` (jsonb, Default `{}`) und `updated_at`. RLS: Policy `service_role_all` für Rolle `service_role`, Befehl `ALL`. Siehe [Supabase-Schema](../supabase-schema/README.md).

`scout_fact_staging` hat die `geo_*`-ID-Spalten und `grain`. Die `scout_*`-Doku gehört nicht zum Location-Guide.

Gemeinde-Facts liegen bei [Quelle 02](../quellen-und-abrufe/quelle-02-zensus-2022.md) auf Grain `ags`. Das 100-m-Gitter liegt in `geo_ref_grid100`.

## How to refresh

1. Neue Zellen oder Grenzen nur aus einer veröffentlichten Geometrie laden.
2. `geo_grid100_id` aus der Südwest-Ecke in EPSG:3035 setzen (`CRS3035RES100mN{northing}E{easting}`). IDs, die die Quelle nicht hergibt, bleiben `null`.
3. ID-Spalten und `grain` setzt der Data-Scout auf dem Pull. Nichtstandard-Gitter und proprietäre Area-Codes an den Location-Guide.
4. PLZ und AGS auf `geo_ref_grid100` füllen, sobald die passende Referenz geladen ist.
5. Crosswalk-Gewichte dokumentieren, bevor Analytics sie nutzt.
6. Policy `service_role_all` beibehalten. Keine Credentials, keine CSV-Dumps, keine Grenzdateien und keine `scout_pull_run`-IDs in Git.

## Open issues

- `geo_ref_admin` mit AGS-Grenzen füllen (`gemeinde`, `kreis`, `land`).
- `geo_ref_plz` füllen.
- `geo_ref_grid100` erweitern, sobald flächendeckende Pulls wieder laufen, und auf dem bestehenden Smoke PLZ sowie AGS nachziehen.
- Adresslayer `geo_ref_address` für Pilotregionen, sobald Adressquellen ankommen.
- Crosswalks Fact ↔ Grid und Fact ↔ Adresse dokumentieren und füllen.
- [Quelle 03](../quellen-und-abrufe/quelle-03-regionalstatistik.md) liefert noch kein Gemeinde-AGS aus der Regionalstatistik.

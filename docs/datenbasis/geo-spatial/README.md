# Geo & Spatial

Räumliche Referenz, Joins und Kartenschlüssel für die Standortberatung. Facts tragen Grain und IDs; Geometrien leben in `geo_ref_*`.

**Owner:** Location-Guide

**Confluence:** [Geo & Spatial](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/21823489)

Supabase-Projekt `tyfwdjzkfvuhasnebhvo`, Region `eu-central-1`. PostGIS ist im Projekt aktiv.

## Status

Standard ist festgeschrieben. Welche `geo_ref_*`-Tabellen befüllt sind, steht in Confluence (Row-Counts nicht hier duplizieren). Bekannt: `geo_ref_grid100` wurde aus einem Zensus-100-m-Smoke geseedet; Admin, PLZ, Adresse und Crosswalk sind als Schema vorbereitet.

## Tabellen / Artefakte

Verbindliche Regeln:

| Regel | Festlegung |
| --- | --- |
| Default-Grain | `grid100` |
| Adresse | nur mit echter Quellenadresse (`geo_addr_id`) |
| Fallback ohne Gitter | PLZ8 → PLZ5 → Gemeinde (`ags`) |
| Fehlende Feinheit | `null`, nicht raten |

Grain-Werte wie in `scout_fact_staging.grain`: `address`, `grid100`, `plz8`, `plz5`, `ags`, `other`.

| Feld | Bedeutung |
| --- | --- |
| `geo_grid100_id` | Zensus/INSPIRE-Code, Südwest-Ecke ETRS89-LAEA |
| `geo_addr_id` | `PLZ\|ORT\|STRASSE\|HNR\|ZUSATZ` |
| `geo_plz8`, `geo_plz5` | PLZ8 bzw. fünfstellige PLZ |
| `geo_ags` | achtstelliger Amtlicher Gemeindeschlüssel |
| `geo_ags5`, `geo_land` | Kreis (5) / Land (2) |
| `lon`, `lat` | WGS84 / EPSG:4326, nur wenn geocodiert |

CRS: Punkte EPSG:4326; Flächen, Admin, PLZ und 100-m-Gitter EPSG:3035. Joins über Text-IDs, noch ohne Foreign Keys auf Staging.

| Tabelle | Primary Key |
| --- | --- |
| `geo_ref_grid100` | `geo_grid100_id` |
| `geo_ref_admin` | `geo_ags` |
| `geo_ref_plz` | `geo_plz8` |
| `geo_ref_address` | `geo_addr_id` |
| `geo_ref_crosswalk` | `id` (`from_grain` / `from_id` → `to_grain` / `to_id`, `weight`) |

RLS: `service_role_all`, siehe [Supabase-Schema](../supabase-schema/README.md).

## How to refresh

1. Neue Zellen oder Grenzen nur aus einer veröffentlichten Geometrie laden.
2. ID-Spalten und `grain` setzt der Data-Scout auf dem Pull; proprietäre Area-Codes an den Location-Guide.
3. Crosswalk-Gewichte dokumentieren, bevor Analytics sie nutzt.
4. Keine Grenzdateien oder Adressregister ins Repo, solange dafür kein Artefakt-Pfad vereinbart ist.

## Open issues

- `geo_ref_admin` und `geo_ref_plz` befüllen.
- Weitere Grid-Zellen, sobald flächendeckende Pulls laufen (Smoke ist nicht nationwide).
- Adresslayer und Crosswalk Fact ↔ Grid / Adresse fehlen.
- [Quelle 03](../quellen-und-abrufe/quelle-03-regionalstatistik.md) liefert noch kein Gemeinde-AGS aus der Regionalstatistik.

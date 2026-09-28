# Quelle 06 — GTFS Deutschland

Nationaler Free-Feed von GTFS.de / DELFI (agency, routes, stops). `stop_times` ist bewusst nicht geladen.

**Owner:** Data-Scout

**Confluence:** [Quelle 06 GTFS Deutschland](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/22052865)

| Feld | Wert |
| --- | --- |
| Source-ID | `gtfs-deutschland` |
| Provider | GTFS.de / DELFI |
| Access | `OPEN` |
| Frequenz | wöchentlich (`latest`) |
| Grain | other (Operator, Linie, Haltestelle) |
| URL | [gtfs.de](https://gtfs.de/) · `germany/free/latest.zip` |

## Status

Platzhalter. Operativer Status in Confluence. Lizenzhinweis (CC BY) gehört in `scout_source`-Notes, nicht als Datei hierher.

## Tabellen / Artefakte

| Tabelle | Grain |
| --- | --- |
| `gtfs_de_agency` | other |
| `gtfs_de_routes` | other |
| `gtfs_de_stops` | other (`stop_lon` / `stop_lat`, WGS84) |

`geo_grid100_id` und `geo_addr_id` bleiben leer, solange der Feed sie nicht hergibt.

## How to refresh

1. `germany/free/latest.zip` laden.
2. Pull `gtfs-deutschland` in `scout_pull_run` protokollieren.
3. agency, routes, stops upserten. `stop_times` nur nach expliziter Entscheidung.
4. Zip nicht committen.

## Open issues

- Wöchentlicher Refresh ist noch nicht automatisiert.
- IFOPT- oder Adress-Mapping mit dem Location-Guide ist offen.
- Abgrenzung zum Mobilithek-BW-Smoke in [Quelle 05](quelle-05-mobilithek.md).

# Quelle 09 — OSM (Berlin)

OpenStreetMap-POIs für Berlin. Nationwide ist deferred. Kein erfundenes `grid100`: IDs bleiben leer, wenn OSM sie nicht liefert.

**Owner:** Data-Scout

**Confluence:** [Quelle 09 OSM (Berlin only)](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/22085633)

| Feld | Wert |
| --- | --- |
| Source-ID | `osm-overpass` |
| Provider | OpenStreetMap / Overpass / Geofabrik |
| Access | `OPEN` |
| Frequenz | kontinuierlich (Community-Extract) |
| Grain | address / `plz5` / other |
| URL | [Overpass](https://overpass-api.de/api/interpreter) |
| Lizenz | ODbL (Attribution in `scout_source`-Notes) |

## Status

**ok (limited).** Nur der Geofabrik-Extract Berlin Stadt; die offizielle Overpass-TLS-Schnittstelle war aus dem Agent-Netz blockiert. Grain address / `plz5` / other. `lon`/`lat` nur aus OSM, kein erfundenes `grid100`. RLS aktiv, Policy `service_role_all`. Nationwide bleibt deferred.

## Tabellen / Artefakte

| Tabelle | Inhalt |
| --- | --- |
| `osm_poi_education` | kindergarten, school, college, university |
| `osm_poi_gastro` | restaurant, cafe, fast_food |
| `osm_poi_health` | doctors, dentist, pharmacy |
| `osm_poi_shop` | shop |

`geo_addr_id` nur bei vollständigen `addr:*`-Tags. `geo_grid100_id`, `geo_plz8`, `geo_ags` bleiben null.

## How to refresh

1. Extract oder Overpass-Antwort für Berlin beziehen. Keine deutschlandweiten Dumps ins Repo.
2. Pull `osm-overpass` in `scout_pull_run` protokollieren.
3. Die vier POI-Tabellen upserten; Koordinaten nur aus der Quelle.
4. Attribution (ODbL) in den Notes belassen.

## Open issues

- Nationwide Overpass / Geofabrik-DE ist deferred.
- Adress-Abdeckung mit dem Location-Guide verbinden, sobald `geo_ref_address` befüllt wird.

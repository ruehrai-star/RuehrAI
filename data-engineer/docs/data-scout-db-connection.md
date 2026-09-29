# Data-Scout Datenbank (Eule)

Nest auf Eule liest Adresspunkte aus der Data-Scout-Postgres. Das ist nicht Supabase und nicht die Brain-Datenbank (`DATABASE_URL`, Schema `app`).

| | |
| --- | --- |
| Host, vom Nest-Prozess auf Eule | `localhost` |
| Port | `5432` |
| Datenbank | `Data-Scout` |
| User | `ruehrai` |
| Passwort | dasselbe wie Brain, nur in der Umgebung |
| Env | `DATASCOUT_DATABASE_URL` |

Platzhalter, kein echtes Secret:

```
DATASCOUT_DATABASE_URL=postgres://ruehrai:ruehrai@localhost:5432/Data-Scout
```

Das Backend liest nur:

| Tabelle | Verwendung |
| --- | --- |
| `geo_ref_address` | `strasse`, `hnr`, `plz` → `lon`/`lat` (EPSG:4326). Etwa 510k Berliner OSM-Zeilen. Index `geo_ref_address_plz_idx`. |
| `geo_ref_plz` | Schwerpunkt `centroid_lon` / `centroid_lat` über `geo_plz5` (der geladene PK `geo_plz8` spiegelt die PLZ5), wenn die Adresse fehlt oder die PLZ außerhalb Berlins liegt. |

`app.store_locations` bleibt auf Brain. Fehlt `DATASCOUT_DATABASE_URL` oder schlägt die Abfrage fehl, nutzt die API den PLZ-Stub in `app.search_places` und danach einen Point in `app.map_features`.

Der Pool setzt `default_transaction_read_only`. Es gibt keinen Nominatim- oder Google-Client in diesem Pfad.

Backfill bestehender Filialen: [`apps/backend/db/ops/kan-56-backfill-store-pins.sql`](../../apps/backend/db/ops/kan-56-backfill-store-pins.sql).

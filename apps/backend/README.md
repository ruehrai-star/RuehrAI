# apps/backend

NestJS-API für den Dev-Team-Slice. Das Backend spricht **nur lokale Postgres** an (`DATABASE_URL`, Treiber `pg`). JWTs stellt dieses Service aus (`POST /auth/login`). Es gibt keinen Supabase-Client und keine Supabase-URL im Code.

Der HTTP-Vertrag liegt in [`packages/api-contracts`](../../packages/api-contracts/README.md). Basis-URL lokal: `http://localhost:3000` (Umgebungsvariable `PORT`).

## Lokal starten

Voraussetzungen: Node 20+, pnpm, Docker (für Postgres).

Im Repo-Root:

```bash
docker compose up -d
cp apps/backend/.env.example apps/backend/.env
pnpm install
pnpm db:migrate
pnpm start:dev
```

`pnpm db:migrate` wendet `db/migrations/*.sql` an und merkt sich angewendete Dateien in `app.schema_migrations`. Der Compose-User ist Superuser und darf `CREATE EXTENSION pgcrypto`.

`006_berlin_plz_centroids.sql` legt PLZ5-Stubs für 12247, 12169 und 12209 an (Berlin, AGS `11000000`, `stub: true` auf dem Point) und stellt `plz5:10115` mit dem Schwerpunkt aus `001_init.sql` sicher (`13.3870`, `52.5320`). Vorhandene Koordinaten bleiben. Danach schreibt die Migration fehlende `store_locations.lon`/`lat` aus dem passenden `search_places`-Schwerpunkt (`grain = plz5`).

`007_berlin_bezirke_stubs.sql` legt für die zwölf Berliner Bezirke synthetische Polygone in `app.map_features` (Layer `berlin-bezirke`) und Schwerpunkte in `app.search_places` an. Je Bezirk zwei Ids mit derselben Rechteck-Geometrie: amtlich `ags:11000001` … `ags:11000012` und Alias `ags:11001001` … `ags:11012012` (`11` plus die dreistellige Nummer zweimal), also auch `ags:11006006` (Steglitz-Zehlendorf) und `ags:11007007` (Tempelhof-Schöneberg). `properties.ags` ist der amtliche Schlüssel. Halbe Kantenlänge 0,18° Länge / 0,095° Breite wie `stubPolygon` für grain `ags`. Keine amtlichen Grenzen. Erneutes Ausführen aktualisiert diese Zeilen. Auf STAGE hat Location-Guide diese Rechtecke durch zwölf echte MultiPolygons ersetzt (`ags:11000001` … `ags:11000012`) und die Alias-Zeilen gelöscht. Diese API sät keine weiteren Stubs und schreibt den Alias nicht erneut: `11006006` wird als `11000006` gespeichert.

`008_drop_muenchen_gemeinde_rectangle.sql` löscht `app.map_features` `ags:09162000` auf Layer `demo-gemeinden` (der achsenparallele Kasten aus `001_init.sql`). Kein Ersatzpolygon. `app.search_places` für München bleibt. Berlin `ags:11000000` und Hamburg `ags:02000000` bleiben Punkte. `app.schema_migrations` speichert nur den Dateinamen, deshalb steht der Kasten nicht mehr in `001_init.sql` und die neue Migration entfernt ihn auf einer Datenbank, die `001` schon angewendet hat.

`009_restore_muenchen_vg250.sql` setzt danach genau das VG250-MultiPolygon wieder ein, das Location-Guide vor `008` in dieser Zeile hatte (`stub: false`, ein Ring, 238 Positionen, EPSG:4326). Die Geometrie steht nicht in `001`, weil `008` sie sonst wieder löscht. Kein Rechteck. `app.target_regions` bleibt unberührt. Berlin und Hamburg bleiben Punkte.

`010_drop_demo_gemeinden.sql` löscht danach alle Features auf `demo-gemeinden`, einschließlich des Polygons aus `009` und der Punkte Berlin und Hamburg. Nichts wird eingesetzt. Der Layer bleibt, `GET /layers/demo-gemeinden` liefert eine leere FeatureCollection. `app.search_places` und `app.target_regions` bleiben.

`.env.example` setzt `DATABASE_URL`, `JWT_SECRET` und `PORT`. Das sind lokale Platzhalter. Echte Secrets nicht committen. `DATASCOUT_DATABASE_URL` bleibt auskommentiert: ohne sie liegen Filial-Pins auf dem PLZ-Stub. Darunter steht der Embeddings-Block (STAGE auf Eule, PROD auf Fuchs) nur als Kommentar; siehe [STAGE / Embeddings](#stage--embeddings). Filial-Koordinaten: [Filial-Pins](#filial-pins-data-scout).

## Seed-Nutzer

Die Migration legt einen Dev-Account an:

| Feld | Wert |
| --- | --- |
| E-Mail | `dev@ruehrai.local` |
| Passwort | `dev-password` |

Alternativ legt `POST /auth/register` weitere Nutzer in derselben Datenbank an. Passwörter hasht Postgres (`pgcrypto`, bcrypt).

### Pool und 503 bei Login und Registrierung

Auf STAGE (Eule) hat Postgres.app dem Nest-LaunchAgent das Trust verweigert. Das setzt Release-Manager in den App-Permissions von Postgres.app. Dafür ist kein neues Nest-Deploy nötig. Dieses Service ändert `DATABASE_URL`, Trust und `pg_hba` nicht.

Der Pool ist nur die Absicherung, wenn die Verbindung danach abbricht. Ohne gesetzte Variablen gelten die Defaults aus `.env.example`: `max` 10, `idleTimeoutMillis` 20000, `connectionTimeoutMillis` 10000, TCP-`keepAlive` an, erster Keepalive nach 10000 ms.

`POST /auth/login` und `POST /auth/register` wiederholen einen abgebrochenen Verbindungsaufbau zweimal (100 ms, dann 200 ms). Danach ist die Antwort **503** mit dem bestehenden `ErrorResponse` (`statusCode`, `message`: `Database temporarily unavailable`, `error`: `Service Unavailable`). Das ist kein Fehler der Angaben (`400`), kein unbekanntes Passwort (`401`) und keine schon vergebene E-Mail (`409`).

Bleibt nach einem späteren Deploy dauerhaft `503`, liegt das außerhalb dieses Prozesses (Brain-Postgres auf Eule). Nicht PROD.

## Endpunkte

| Methode | Pfad | Auth |
| --- | --- | --- |
| `GET` | `/health` | öffentlich (Liveness, ohne Datenbank) |
| `POST` | `/auth/login` | öffentlich, antwortet mit JWT |
| `POST` | `/auth/register` | öffentlich, legt Nutzer in `app.users` an, antwortet mit JWT |
| `POST` | `/auth/logout` | Bearer JWT, widerruft die `jti` bis `exp` |
| `GET` | `/auth/me` | Bearer JWT |
| `GET` | `/search` | Bearer JWT |
| `GET` | `/layers/{id}` | Bearer JWT |
| `GET` / `POST` / `DELETE` | `/target-region` | Bearer JWT, Liste der Zielregionen (Menge für die Standortsuche) |
| `DELETE` | `/target-region/{geoKey}` | Bearer JWT, einen Katalogort aus der Liste nehmen |
| `GET` / `POST` | `/stores` | Bearer JWT, Filialadressen des Nutzers |
| `GET` / `PUT` / `DELETE` | `/stores/{id}` | Bearer JWT |
| `GET` / `PUT` | `/stores/{id}/revenue` | Bearer JWT, Monatsumsatz (max. 36 Monate) |
| `DELETE` | `/stores/{id}/revenue/{year}/{month}` | Bearer JWT |
| `GET` | `/analysis/input` | Bearer JWT, strukturierter Analyse-Input (KAN-31) |
| `POST` | `/analysis/runs` | Bearer JWT, Snapshot, Brain-Suche, Muster (KAN-31/32/35) |
| `GET` | `/analysis/runs/{id}` | Bearer JWT, ein Lauf des Nutzers |
| `GET` | `/analysis/pattern` | Bearer JWT, zuletzt persistiertes Muster |
| `POST` | `/recommendations` | Bearer JWT, Top 3 aus dem Muster (KAN-38/39/42) |
| `GET` | `/recommendations` | Bearer JWT, zuletzt gespeicherte Empfehlungen des Nutzers |
| `POST` | `/address-pair` | Bearer JWT, zwei Adressen über die PLZ (Gemeinde / Kreis / Land) |

Geschützte Routen ohne gültiges Bearer-Token antworten mit `401`.

Beispiel:

```bash
curl -s http://localhost:3000/health

curl -s -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"dev@ruehrai.local","password":"dev-password"}'

curl -s 'http://localhost:3000/search?q=M%C3%BCnchen' \
  -H "authorization: Bearer $TOKEN"

curl -s http://localhost:3000/layers/demo-gemeinden \
  -H "authorization: Bearer $TOKEN"

# TOKEN ist accessToken aus dem Login-JSON. STORE_ID ist id aus der POST-Antwort.
# Zielregion an die Liste, Filiale, Umsatz, dann Logout (danach ist dasselbe Token 401).
curl -s -X POST http://localhost:3000/target-region \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"label":"München","grain":"ags","geoKey":"09162000","ags":"09162000"}'

curl -s -X POST http://localhost:3000/stores \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"street":"Marienplatz 1","postalCode":"80331","city":"München"}'

curl -s -X PUT "http://localhost:3000/stores/$STORE_ID/revenue" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"points":[{"year":2025,"month":1,"revenueEur":18450.5},{"year":2025,"month":2,"revenueEur":null}]}'

curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/auth/logout \
  -H "authorization: Bearer $TOKEN"
```

`revenueEur: null` markiert den Monat als fehlend. Ein Monat ohne Zeile ist noch nicht erfasst. Pro Filiale liegen höchstens 36 Monate.

Musteranalyse (OpenAPI 0.3.0) liest dieselben Daten. `GET /analysis/input` und `POST /analysis/runs` antworten `404`, wenn die Zielregion-Liste leer ist, und `400`, wenn keine Filiale zwei aufeinanderfolgende Monate mit gesetztem Umsatz hat. Ein Lauf speichert Input, die benutzten Brain-Fakten und das Muster in `app.analysis_runs`. `GET /analysis/pattern` liefert das neueste Muster.

Karte (OpenAPI 0.5.0): `GET /stores` liefert `lon`/`lat` in WGS84. Fehlt das Paar, gilt beim Schreiben und beim Lesen die Reihenfolge aus [Filial-Pins](#filial-pins-data-scout). Create und Update speichern das Paar. Trifft das Lesen einen Treffer, schreibt es `lon`/`lat` nach `app.store_locations` (fehlendes Paar, oder ein Adresstreffer statt eines PLZ-Schwerpunkts), damit der nächste Abruf und die Datenbank dasselbe Paar haben. Ein explizites Paar bleibt unverändert. `GET /target-region` liefert `{ items }` (neueste zuerst). Jedes Item hat `bounds` (`west`, `south`, `east`, `north`) und `geometry` (GeoJSON Polygon oder MultiPolygon, Länge dann Breite) plus Name, `level` und `parentLabel`. `POST /target-region` hängt einen Katalogort an; ein zweites POST desselben Schlüssels ändert die Liste nicht. `DELETE /target-region/{geoKey}` nimmt einen Ort heraus. `DELETE /target-region` leert die Liste. Es gibt kein PUT, das die einzige Zeile überschreibt. Ohne Geometrie im POST kommt die Fläche zuerst aus Brain `geo`, dann `app.map_features`. Fehlt dort das Polygon und ist `DATASCOUT_DATABASE_URL` gesetzt, liest die API einen Berliner Bezirk aus Data-Scout `geo_ref_bezirk` (`geom` als GeoJSON, EPSG:4326) und eine Gemeinde, einen Kreis oder ein Land aus `geo_ref_admin` (VG250, nach WGS84 transformiert). Ein mitgeschicktes Polygon gewinnt; `bounds` ohne Polygon wird nicht zum Rechteck. Ein Alias `11` + nnn + nnn (zum Beispiel `11006006`) wird vor dem Lookup auf `1100000N` gesetzt und so in `ags` und `geoKey` gespeichert. Ein erfolgreiches POST speichert nie `geometry` null: fehlt im Body und in beiden Katalogen jede Fläche, antwortet der Aufruf `400` und lässt die Liste stehen. `GET` darf eine ältere Null-Fläche weiter aus dem Katalog füllen. Diese API sät keine weiteren Rechteck-Stubs.

Top-3-Empfehlungen (OpenAPI 0.4.0) lesen dieses Muster. `POST /recommendations` sucht in der Zielregion Brain-Standorte, deren Kriterien sich in den letzten sechs Kalendermonaten (UTC) in die Richtung des Musters bewegt haben, und speichert höchstens drei Treffer. Ein oder zwei Treffer sind kein Fehler: `reason` erklärt das auf Deutsch. Ohne abgeschlossenes Muster antwortet der Aufruf `404`. `GET /recommendations` liefert das neueste Set dieses Nutzers. `source` an jeder Begründung ist `llm` oder `heuristic`.

```bash
curl -s http://localhost:3000/analysis/input \
  -H "authorization: Bearer $TOKEN"

curl -s -X POST http://localhost:3000/analysis/runs \
  -H "authorization: Bearer $TOKEN"

curl -s http://localhost:3000/analysis/pattern \
  -H "authorization: Bearer $TOKEN"

curl -s -X POST http://localhost:3000/recommendations \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{}'

curl -s http://localhost:3000/recommendations \
  -H "authorization: Bearer $TOKEN"
```

Gesäte Layer: `demo-gemeinden`, `demo-plz`, `demo-grid100`. `demo-gemeinden` hat keine Features. `demo-plz` und `demo-grid100` sind synthetische Punkt-Stubs, keine amtlichen Grenzen. `/layers/{id}` liest diese Tabellen in `app`, auch wenn die Feature-Docs noch keine Koordinaten haben.

`/search` liest Brain `geo` (`geo_ref_plz`, `geo_ref_bezirk`, `geo_ref_ortsteil`) unter `SET ROLE backend_ro_features` und dazu `features.v_location_search`, sobald die View mindestens eine Zeile hat. Katalog-Treffer tragen `level` (`plz`, `bezirk` nur Berlin `11000001`–`11000012`, `stadtbezirk`, `stadtteil`, `ortsteil`) und `parentLabel` (Name der Eltern-Gemeinde, kein Badge). Freitext `q` trifft Name und `parentLabel`, nicht interne Schlüssel (`plz5:…`, `ortsteil:osm:…`, `ags:…`). Eine Zeile ohne Namen erscheint nicht. PLZ-Treffer nur, wenn `q` ausschließlich Ziffern ist. `geoKey` bleibt ein exakter Reload der gespeicherten Id. `lon`/`lat` dürfen null sein. Filter: `q`, `type` (`address` | `ags` | `plz`), `address`, `ags`, `plz`, `geoKey`, `grain`. Ein Treffer ist eine Place-Id, kein Polygon. Der Zielregion-Picker schickt diese Id an `POST /target-region` ohne `geometry`. Die Fläche kommt zuerst aus `geo` (echtes MultiPolygon), dann aus einem nicht-stub `app.map_features`, dann Data-Scout. Zeilen ohne `geom` erscheinen nicht. Rechtecke aus Bounds oder einem Punkt werden nicht gespeichert; fehlt die Fläche, antwortet POST `400`.

Hat die View keine Zeilen oder fehlt sie (frisches `docker compose`, ohne Brain-Daten), gilt derselbe Filter auf `app.search_places`. Ein Prozess merkt sich den Fallback im Log einmal pro Grund.

## Datenbank

Zwei Schemas. `public` bleibt für App-Tabellen ungenutzt.

| Schema | Wer | Inhalt |
| --- | --- | --- |
| `app` | diese Migrationen | `users` (Login, `bigint identity`), `revoked_tokens` (Logout-`jti`), `target_regions` (Liste der Zielregionen je Nutzer, plus `bounds_*`, GeoJSON-`geometry`, `level`, `parent_label`), `store_locations` (Filialadressen, WGS84 `lon`/`lat`), `store_monthly_revenue` (Umsatz je Monat; `NULL` = als fehlend markiert), `analysis_runs` (Snapshot, Brain-Fakten, Muster als JSON), `recommendation_sets` (Top-3-Payload als JSON), `search_places` (Such-Fallback und PLZ-Schwerpunkte), `map_layers` / `map_features` (GeoJSON-Stubs) |
| `features` | Data-Engineer, Brain | `location_feature_docs`, `embedding_jobs`, View `v_location_search` |

Die View-Spalten, die `/search` benutzt: `id`, `geo_key`, `grain`, `name`, `title`, `lon`, `lat`. `ref_period` liegt auf der View, filtert dieser Slice nicht. Koordinaten und Embeddings können leer sein.

Verbindung: `pg.Pool` (max. 10) mit `DATABASE_URL`. Autorisierung der HTTP-Routen prüft das Backend am JWT. `app.store_locations` bleibt auf dieser Datenbank. Data-Scout ist ein zweiter Pool, siehe unten.

### Filial-Pins (Data-Scout)

KAN-56 Option A. Create und Update suchen ohne Koordinaten in Data-Scout `geo_ref_address` (`strasse`, `hnr` aus `street`, `plz`). Der PLZ5-Schwerpunkt ist nur der Fallback ohne Adresstreffer. Ein mitgeschicktes `lon`/`lat`-Paar gewinnt, ist aber keine Pflicht und nicht die primäre Quelle. Kein öffentlicher Geocoder, kein Supabase. Verbindung: [`data-engineer/docs/data-scout-db-connection.md`](../../data-engineer/docs/data-scout-db-connection.md).

| Schritt | Quelle |
| --- | --- |
| optional | Explizites `lon`/`lat` im Request, beide gesetzt. Sonst übersprungen |
| 1 | `geo_ref_address` (`strasse`, `hnr` aus `street`, `plz`) → `lon`/`lat` EPSG:4326. Index `geo_ref_address_plz_idx`. Berlin, OSM |
| 2 | `geo_ref_plz` Schwerpunkt (`centroid_lon` / `centroid_lat`), nur ohne Adresstreffer |
| 3 | `app.search_places`, danach ein Point in `app.map_features`, nur ohne Adresstreffer und ohne `geo_ref_plz` |

`DATASCOUT_DATABASE_URL` leer oder die Abfrage schlägt fehl: Schritte 1 und 2 entfallen, Schritt 3 bleibt. Der Data-Scout-Pool liest nur (`default_transaction_read_only`). Schema `app` wird dort nicht geschrieben.

`GET /stores` und `GET /stores/{id}` schreiben die Koordinate nach `app.store_locations`, wenn sie vorher null war, oder wenn ein Adresstreffer einen gespeicherten PLZ-Schwerpunkt ersetzt. Ein abweichender expliziter Pin bleibt.

Backfill bestehender Berliner Filialen (PLZ 12247, 12169, 12209, 10115) läuft nach dem Deploy. Der Release-Manager führt ihn auf Eule aus. Bevorzugt das SQL, das Brain schreibt und Data-Scout nur liest:

```bash
psql "$DATABASE_URL" -v datascout_conn="$DATASCOUT_DATABASE_URL" \
  -f apps/backend/db/ops/kan-56-backfill-store-pins.sql
```

`dblink` muss einmal als Superuser existieren (`CREATE EXTENSION dblink`). Ohne die Extension, derselbe Abgleich über das API-Parsing:

```bash
pnpm --filter @ruehrai/backend store-pins:backfill -- --dry-run
pnpm --filter @ruehrai/backend store-pins:backfill
```

Das SQL liegt nicht in `db/migrations` und läuft nicht bei `pnpm db:migrate`.

### STAGE / Embeddings

CTO-Korrektur 2026-09-29: STAGE läuft auf Eule (`168.192.2.194`) mit lokalem oMLX. Die Embeddings- und LLM-Basis-URL von STAGE/Eule ist `http://localhost:8000/v1`. Fuchs (`168.192.2.123`) bleibt PROD/remote oMLX. OpenAI ist für Embeddings verboten.

| Angabe | Wert |
| --- | --- |
| STAGE (Eule `168.192.2.194`) | `EMBEDDINGS_BASE_URL=http://localhost:8000/v1` |
| PROD / remote Fuchs (`168.192.2.123`) | `EMBEDDINGS_BASE_URL=http://168.192.2.123:8000/v1` (localhost, wenn der Prozess auf Fuchs läuft) |
| Modell | `rg113/jina-embeddings-v5-text-small-retrieval-mlx-oQ8` |
| Vektor-Dimension | `1024` |

Die Werte stehen auskommentiert in `.env.example` als `EMBEDDINGS_BASE_URL`, `EMBEDDING_MODEL`, `EMBEDDING_DIM` und `OMLX_API_KEY`. Optional: `LLM_BASE_URL` (sonst dieselbe Basis wie `EMBEDDINGS_BASE_URL`) und `LLM_MODEL` (oMLX-Modellname für `/v1/chat/completions`). `ANALYSIS_VECTOR_SEARCH=0` schaltet die Vektorsuche ab, auch wenn die URL gesetzt ist.

Auf Eule verlangt oMLX einen API-Key. Den Wert aus `~/.omlx/settings.json` (`auth.api_key`) nach `OMLX_API_KEY` in `apps/backend/.env` kopieren. Den echten Wert nicht committen. Ist die Variable gesetzt, schickt dieses Service bei jedem oMLX-Aufruf (`POST …/embeddings` und `POST …/chat/completions`) den Header `Authorization: Bearer` mit diesem Key. oMLX akzeptiert denselben Key auch als `x-api-key`; dieser Client sendet nur Bearer. Clients rufen oMLX nicht auf.

Fehlt `OMLX_API_KEY` oder ist sie leer, startet der Prozess trotzdem. Der Aufruf geht ohne Authorization-Header raus. Verlangt oMLX den Key, antwortet es mit HTTP 401. Musteranalyse und Empfehlungen bleiben dann auf dem SQL- und Heuristik-Pfad. Query-Embeddings und `source=llm` (Muster und Begründungen) brauchen den Key.

`GET /search` bleibt ein SQL-Filter auf `features.v_location_search` (ohne Zeilen in der View: `app.search_places`) und ruft oMLX nicht auf. Schreibseitige Embeddings gehören Brain und Data-Engineer. Es gibt keinen OpenAI-Client.

Die Musteranalyse darf oMLX lesen, nur serverseitig:

| Schritt | Aufruf | Wenn der Dienst fehlt |
| --- | --- | --- |
| Query-Embedding (KAN-32) | `POST $EMBEDDINGS_BASE_URL/embeddings` | SQL-Filter auf `features.v_location_search` oder `features.location_feature_docs` (AGS, PLZ, `geo_key`). Der Lauf meldet `brain.mode: sql` und einen `vectorUnavailableReason`. |
| Muster (KAN-35) | `POST $LLM_BASE_URL/chat/completions`, nur wenn `LLM_MODEL` gesetzt ist | Deterministisches Muster aus Umsatzreihe und Brain-Signalen, `pattern.source: heuristic`. Ein LLM-Muster wird verworfen, wenn ein Kriterium nicht in den gelesenen Fakten steht. |
| Begründung (KAN-42) | derselbe Chat-Aufruf, höchstens drei Standorte | Deutscher Heuristik-Text, `source: heuristic`. Ein LLM-Text wird verworfen, wenn er eine Zahl nennt, die nicht in der Kriterien-Evidenz steht. |

Die Vektorsuche sortiert mit Kosinus-Distanz (`embedding <=>`). Ein HNSW-Index auf Brain wird vom Planner genutzt, wenn er zur Filterung passt. Dieses Service legt den Index nicht an. Fehlt die Spalte `embedding`, schlägt die Dimension fehl, fehlt `OMLX_API_KEY` bei eingeschalteter oMLX-Auth (HTTP 401) oder ist oMLX nicht erreichbar, bleibt der SQL-Pfad. `source=llm` entsteht nur nach einem erfolgreichen Chat mit gesetztem `LLM_MODEL` und akzeptiertem `OMLX_API_KEY`.

### Lesen von `features`

Rolle `backend_ro_features` ist `NOLOGIN` und hat `SELECT` auf `features`. Nach dem Connect als App-User setzt jede Feature-Abfrage das in einer Transaktion:

```sql
BEGIN;
SET LOCAL ROLE backend_ro_features;
-- SELECT … FROM features.v_location_search
COMMIT;
```

`SET LOCAL` endet mit der Transaktion. Die gepoolte Session bleibt der User aus `DATABASE_URL` und kann weiter nach `app` schreiben. Der App-User muss Mitglied der Rolle sein:

```sql
GRANT USAGE ON SCHEMA features TO backend_ro_features;
GRANT SELECT ON features.v_location_search TO backend_ro_features;
GRANT backend_ro_features TO <database_url_user>;
```

Fehlt die Rolle, liest der Prozess die View als den verbundenen User. Dafür braucht dieser User dieselben Rechte direkt:

```sql
GRANT USAGE ON SCHEMA features TO <database_url_user>;
GRANT SELECT ON features.v_location_search TO <database_url_user>;
```

`docker compose` legt `features` nicht an. `/search` nutzt dann `app.search_places`. `ags` und `plz` auf dieser Fallback-Tabelle sind indiziert.

## Skripte

| Skript | Wirkung |
| --- | --- |
| `pnpm start:dev` | API mit Reload |
| `pnpm build` | `nest build` nach `dist/` |
| `pnpm test` | Unit-Tests plus Smoke (`/health`, `401` auf geschützten Routen) |
| `pnpm db:migrate` | SQL-Migrationen |

`POST /auth/logout` ist das serverseitige Session-Ende für das JWT-only-Slice. Das Access-Token trägt eine `jti`. Logout schreibt sie nach `app.revoked_tokens` bis `exp`; der Guard lehnt dasselbe Token danach ab. Es gibt keine Refresh-Tokens und keine Supabase-Session. Ein reines Löschen im Client würde ein noch gültiges Token nicht ungültig machen, deshalb die Denylist. Abgelaufene Einträge löscht der nächste Logout. Tokens ohne `jti` (keines, das dieser Service noch ausstellt) lassen sich nicht widerrufen und gelten bis `exp`.

Postgres-Tests (Login, Logout, Zielregion, Filialen, Umsatz, Suche, Layer) gegen eine migrierte Datenbank:

```bash
RUN_DB_TESTS=1 pnpm --filter @ruehrai/backend test
```

Vom Repo-Root gelten dieselben Namen: `pnpm start:dev`, `pnpm build`, `pnpm test`, `pnpm db:migrate`. Installieren mit `pnpm install`.

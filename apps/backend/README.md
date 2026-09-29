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

`pnpm db:migrate` wendet `db/migrations/*.sql` an und merkt sich angewendete Dateien in `app.schema_migrations`. Die Migrationen legen Schema `app` an und brauchen kein `pgcrypto`.

`.env.example` setzt `DATABASE_URL`, `JWT_SECRET` und `PORT`. Das sind lokale Platzhalter. Echte Secrets nicht committen. Darunter steht der Embeddings-Block (STAGE auf Eule, PROD auf Fuchs) nur als Kommentar; siehe [STAGE / Embeddings](#stage--embeddings).

## Seed-Nutzer

Die Migration legt einen Dev-Account an:

| Feld | Wert |
| --- | --- |
| E-Mail | `dev@ruehrai.local` |
| Passwort | `dev-password` |

Alternativ legt `POST /auth/register` weitere Nutzer in derselben Datenbank an. Passwörter hasht der API-Prozess mit bcrypt (Kosten 10). Bestehende `pgcrypto`-Hashes (`$2a$`) bleiben gültig.

### Registrierung oder Login antwortet mit 500

`POST /auth/register` liefert `400`, wenn der Body ungültig ist, und `409`, wenn die E-Mail schon in `app.users` steht. `POST /auth/login` liefert `401` bei unbekannter E-Mail oder falschem Passwort. `500` heißt: die Abfrage auf `app.users` ist in Postgres fehlgeschlagen. Das Prozess-Log nennt SQLSTATE und Constraint, nicht das Passwort.

Ein früherer Stand hat `crypt()` und `gen_salt()` aus `pgcrypto` unqualifiziert aufgerufen. Liegt die Extension nicht im `search_path` (typisch `search_path=app`), antwortet Postgres mit SQLSTATE `42883` (`function gen_salt(unknown, integer) does not exist` bzw. `function crypt(unknown, text) does not exist`). Das trifft Login und Register, auch für eine unbekannte E-Mail. Ein ungültiger Body bleibt `400`.

Wenn STAGE nach diesem Stand weiter `500` liefert, prüft Release-Manager die STAGE-Datenbank. Nicht PROD.

```sql
SELECT to_regclass('app.users') AS users_table;
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'app' AND table_name = 'users'
ORDER BY ordinal_position;
```

Erwartete Spalten: `id` (bigint identity), `email`, `password_hash`, `created_at`. Ist `users_table` null, Migrationen aus diesem Repo anwenden (`pnpm db:migrate`) mit einer Rolle, die Schema `app` anlegen darf.

SQLSTATE `42501` (Recht fehlt): Login braucht `SELECT`. Register braucht zusätzlich `INSERT` und `USAGE` auf der Identity-Sequenz.

```sql
GRANT USAGE ON SCHEMA app TO <database_url_user>;
GRANT SELECT, INSERT ON app.users TO <database_url_user>;
GRANT USAGE, SELECT ON SEQUENCE app.users_id_seq TO <database_url_user>;
```

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
| `GET` / `PUT` / `DELETE` | `/target-region` | Bearer JWT, eine Zielregion je Nutzer |
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
# Zielregion, Filiale, Umsatz, dann Logout (danach ist dasselbe Token 401).
curl -s -X PUT http://localhost:3000/target-region \
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

Musteranalyse (OpenAPI 0.3.0) liest dieselben Daten. `GET /analysis/input` und `POST /analysis/runs` antworten `404`, wenn keine Zielregion gespeichert ist, und `400`, wenn keine Filiale zwei aufeinanderfolgende Monate mit gesetztem Umsatz hat. Ein Lauf speichert Input, die benutzten Brain-Fakten und das Muster in `app.analysis_runs`. `GET /analysis/pattern` liefert das neueste Muster.

Karte (OpenAPI 0.5.0): `GET /stores` liefert `lon`/`lat` in WGS84. Fehlt das Paar, setzt Create, Update und das Lesen den PLZ-Schwerpunkt aus `app.search_places` (danach ein Point in `app.map_features`). Ein explizites Paar bleibt unverändert. `GET /target-region` liefert zusätzlich `bounds` (`west`, `south`, `east`, `north`) und `geometry` (GeoJSON Polygon oder MultiPolygon, Länge dann Breite). Das Web setzt `fitBounds` auf die Filialpunkte vereinigt mit `bounds` und zeichnet `geometry` halbtransparent mit Umriss. Beschriftungen bleiben im Client. Ohne Geometrie im PUT kommt die Fläche aus `app.map_features` (derselbe Stub wie `/layers/{id}`, für München der Kasten) oder als Rechteck um den Katalogpunkt. Ein mitgeschicktes Polygon gewinnt; `bounds` ohne Polygon wird zum Rechteck.

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

Gesäte Layer: `demo-gemeinden`, `demo-plz`, `demo-grid100`. Geometrien sind synthetische Stubs (Punkte und ein grober Polygon-Kasten), keine amtlichen Grenzen. `/layers/{id}` liest diese Tabellen in `app`, auch wenn die Feature-Docs noch keine Koordinaten haben.

`/search` liest `features.v_location_search`, sobald die View mindestens eine Zeile hat. Treffer kommen aus `name` (sonst `title` oder `geo_key`), `grain` und `geo_key`. `lon`/`lat` dürfen null sein. Filter: `q`, `type` (`address` | `ags` | `plz`), `address`, `ags`, `plz`, `geoKey`, `grain`.

Hat die View keine Zeilen oder fehlt sie (frisches `docker compose`, ohne Brain-Daten), gilt derselbe Filter auf `app.search_places`. Ein Prozess merkt sich den Fallback im Log einmal pro Grund.

## Datenbank

Zwei Schemas. `public` bleibt für App-Tabellen ungenutzt.

| Schema | Wer | Inhalt |
| --- | --- | --- |
| `app` | diese Migrationen | `users` (Login, `bigint identity`), `revoked_tokens` (Logout-`jti`), `target_regions` (eine Zielregion je Nutzer, plus `bounds_*` und GeoJSON-`geometry`), `store_locations` (Filialadressen, WGS84 `lon`/`lat`), `store_monthly_revenue` (Umsatz je Monat; `NULL` = als fehlend markiert), `analysis_runs` (Snapshot, Brain-Fakten, Muster als JSON), `recommendation_sets` (Top-3-Payload als JSON), `search_places` (Such-Fallback und PLZ-Schwerpunkte), `map_layers` / `map_features` (GeoJSON-Stubs) |
| `features` | Data-Engineer, Brain | `location_feature_docs`, `embedding_jobs`, View `v_location_search` |

Die View-Spalten, die `/search` benutzt: `id`, `geo_key`, `grain`, `name`, `title`, `lon`, `lat`. `ref_period` liegt auf der View, filtert dieser Slice nicht. Koordinaten und Embeddings können leer sein.

Verbindung: `pg.Pool` (max. 10) mit `DATABASE_URL`. Autorisierung der HTTP-Routen prüft das Backend am JWT.

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

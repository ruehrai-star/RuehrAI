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

`.env.example` setzt `DATABASE_URL`, `JWT_SECRET` und `PORT`. Das sind lokale Platzhalter. Echte Secrets nicht committen. Darunter steht der STAGE-Embeddings-Block nur als Kommentar; siehe [STAGE / Embeddings](#stage--embeddings).

## Seed-Nutzer

Die Migration legt einen Dev-Account an:

| Feld | Wert |
| --- | --- |
| E-Mail | `dev@ruehrai.local` |
| Passwort | `dev-password` |

Alternativ legt `POST /auth/register` weitere Nutzer in derselben Datenbank an. Passwörter hasht Postgres (`pgcrypto`, bcrypt).

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

Gesäte Layer: `demo-gemeinden`, `demo-plz`, `demo-grid100`. Geometrien sind synthetische Stubs (Punkte und ein grober Polygon-Kasten), keine amtlichen Grenzen. `/layers/{id}` liest diese Tabellen in `app`, auch wenn die Feature-Docs noch keine Koordinaten haben.

`/search` liest `features.v_location_search`, sobald die View mindestens eine Zeile hat. Treffer kommen aus `name` (sonst `title` oder `geo_key`), `grain` und `geo_key`. `lon`/`lat` dürfen null sein. Filter: `q`, `type` (`address` | `ags` | `plz`), `address`, `ags`, `plz`, `geoKey`, `grain`.

Hat die View keine Zeilen oder fehlt sie (frisches `docker compose`, ohne Brain-Daten), gilt derselbe Filter auf `app.search_places`. Ein Prozess merkt sich den Fallback im Log einmal pro Grund.

## Datenbank

Zwei Schemas. `public` bleibt für App-Tabellen ungenutzt.

| Schema | Wer | Inhalt |
| --- | --- | --- |
| `app` | diese Migrationen | `users` (Login, `bigint identity`), `revoked_tokens` (Logout-`jti`), `target_regions` (eine Zielregion je Nutzer), `store_locations` (Filialadressen), `store_monthly_revenue` (Umsatz je Monat; `NULL` = als fehlend markiert), `search_places` (Such-Fallback), `map_layers` / `map_features` (GeoJSON-Stubs) |
| `features` | Data-Engineer, Brain | `location_feature_docs`, `embedding_jobs`, View `v_location_search` |

Die View-Spalten, die `/search` benutzt: `id`, `geo_key`, `grain`, `name`, `title`, `lon`, `lat`. `ref_period` liegt auf der View, filtert dieser Slice nicht. Koordinaten und Embeddings können leer sein.

Verbindung: `pg.Pool` (max. 10) mit `DATABASE_URL`. Autorisierung der HTTP-Routen prüft das Backend am JWT.

### STAGE / Embeddings

CTO-Entscheidung 2026-09-29: STAGE nutzt lokale LLM- und Embedding-Modelle auf Fuchs oMLX. OpenAI ist für Embeddings verboten.

| Angabe | Wert |
| --- | --- |
| Auf Fuchs | `http://localhost:8000/v1` |
| Von Eule (Mesh) | `http://168.192.2.123:8000/v1` |
| Modell | `rg113/jina-embeddings-v5-text-small-retrieval-mlx-oQ8` |
| Vektor-Dimension | `1024` |

Die Werte stehen auskommentiert in `.env.example` als `EMBEDDINGS_BASE_URL`, `EMBEDDING_MODEL` und `EMBEDDING_DIM`. Von Eule zeigt `EMBEDDINGS_BASE_URL` auf `http://168.192.2.123:8000/v1`; auf Fuchs selbst auf `http://localhost:8000/v1`.

Das Backend ruft diesen Endpoint nicht auf. Schreibseitige Embeddings gehören Brain und Data-Engineer. `GET /search` bleibt ein SQL-Filter auf `features.v_location_search` (ohne Zeilen in der View: `app.search_places`). Es gibt keinen OpenAI-Client in diesem Service.

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

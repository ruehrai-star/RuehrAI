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

`.env.example` enthält `DATABASE_URL`, `JWT_SECRET` und `PORT`. Das sind lokale Platzhalter. Echte Secrets nicht committen.

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
| `POST` | `/auth/register` | öffentlich, antwortet mit JWT |
| `GET` | `/auth/me` | Bearer JWT |
| `GET` | `/search` | Bearer JWT |
| `GET` | `/layers/{id}` | Bearer JWT |

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
```

Gesäte Layer: `demo-gemeinden`, `demo-plz`, `demo-grid100`. Geometrien sind synthetische Stubs (Punkte und ein grober Polygon-Kasten), keine amtlichen Grenzen.

## Datenbank

Schema `app`:

| Tabelle | Inhalt |
| --- | --- |
| `app.users` | Login (`bigint identity` als Primärschlüssel) |
| `app.search_places` | Suchtreffer (`id`, `label`, `grain`, optionale `lon`/`lat`) |
| `app.map_layers` / `app.map_features` | GeoJSON-Stubs für `/layers/{id}` |

`ags` und `plz` sind indiziert. Zugriff läuft über einen `pg.Pool` (max. 10 Verbindungen). Autorisierung prüft die API am JWT; die Datenbankrolle ist die App-Rolle aus `DATABASE_URL`.

Vektor-Tabellen sind in diesem Slice noch nicht angelegt. Dieselbe lokale Postgres ist der vorgesehene Ort dafür.

## Skripte

| Skript | Wirkung |
| --- | --- |
| `pnpm start:dev` | API mit Reload |
| `pnpm build` | `nest build` nach `dist/` |
| `pnpm test` | Unit-Tests plus Smoke (`/health`, `401` auf geschützten Routen) |
| `pnpm db:migrate` | SQL-Migrationen |

Postgres-Tests (Login, Suche, Layer) gegen eine migrierte Datenbank:

```bash
RUN_DB_TESTS=1 pnpm --filter @ruehrai/backend test
```

Vom Repo-Root gelten dieselben Namen: `pnpm start:dev`, `pnpm build`, `pnpm test`, `pnpm db:migrate`. Installieren mit `pnpm install`.

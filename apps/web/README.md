# RuehrAI Web

Map, search, and Standort-Eingaben for Standortberatung. The UI calls the Backend through `lib/api`, typed with [`@ruehrai/api-contracts`](../../packages/api-contracts/README.md). There is no in-process mock on the happy path, and no Supabase client. If a call cannot reach the Backend, the screen shows the error. Client fixtures are not substituted for live responses; anything that is only demo data must be labeled **Demo-Daten**.

`GET /search`, `GET /layers/{id}`, `POST /auth/login`, and `POST /auth/register` go to `NEXT_PUBLIC_API_BASE_URL`. The default is `http://localhost:3000`, the Backend's local port. This app listens on **3001** so both can run together.

Search and layers send `Authorization: Bearer`. Anmelden and Registrieren store the JWT from `TokenResponse` in `sessionStorage` under `ruehrai.session`. The contract has no logout route; **Abmelden** removes that record and returns to `/login`.

Labels follow the UX gate: **Anmelden**, **Registrieren**, **Abmelden**, **Suche**, **Treffer**, **Layer**.

## Run against the Backend

Start the Backend first (see [`apps/backend/README.md`](../backend/README.md)): Postgres, `pnpm db:migrate`, `pnpm start:dev`. Seed login: `dev@ruehrai.local` / `dev-password`.

From the repo root:

```bash
pnpm install
pnpm --filter @ruehrai/web dev
```

Open http://localhost:3001.

| Flow | Route | Backend |
| --- | --- | --- |
| Registrieren | `/register` | `POST /auth/register` (201, JWT). The map opens signed in. |
| Anmelden | `/login` | `POST /auth/login`. Invalid credentials stay on the form with an error. |
| Abmelden | header | Clears `sessionStorage` and opens `/login`. |
| Karte + Suche | `/` | `GET /layers/demo-gemeinden` (default layer) and `GET /search`. |
| Zielregion | `/standorte#zielregion` | Pick a Treffer from `GET /search`, then save the target region. |
| Filialadressen | `/standorte#filialadressen` | List, add, edit, and remove store addresses. |
| Umsatz | `/standorte#umsatz` | Monthly revenue per store. Empty months are marked **fehlend**. `0` is a stored value. |

Zielregion, Filialadressen, and Umsatz are saved only through operations published in `@ruehrai/api-contracts`. Until those operations exist, `/standorte` still lets you search a region, and the save actions stay disabled. The page says so. It does not write Demo-Daten.

To point at another API:

```bash
NEXT_PUBLIC_API_BASE_URL=https://api.example.com pnpm --filter @ruehrai/web dev
```

`NEXT_PUBLIC_*` is baked in at build time. Set it before `pnpm --filter @ruehrai/web build` for a deployed bundle.

`pnpm install` copies the MapLibre worker into `apps/web/public/maplibre` (gitignored). The map loads that file because the Next bundler does not expose the worker as a JavaScript module.

## Checks

```bash
pnpm --filter @ruehrai/web lint
pnpm --filter @ruehrai/web typecheck
pnpm --filter @ruehrai/web test
pnpm --filter @ruehrai/web build
```

`typecheck` and `build` compile `@ruehrai/api-contracts` first. The web tests cover URL building, the bearer header, login/register token mapping, and the Standort input rules (missing Umsatz vs. zero). They do not start the Backend.

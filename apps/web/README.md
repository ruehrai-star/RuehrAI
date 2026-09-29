# RuehrAI Web

Map, search, and Standort-Eingaben for Standortberatung. The UI calls the Backend through `lib/api`, typed with [`@ruehrai/api-contracts`](../../packages/api-contracts/README.md). There is no in-process mock on the happy path, and no Supabase client. If a call cannot reach the Backend, the screen shows the error. Client fixtures are not substituted for live responses; anything that is only demo data must be labeled **Demo-Daten**.

`GET /search`, `GET /layers/{id}`, `POST /auth/login`, and `POST /auth/register` go to `NEXT_PUBLIC_API_BASE_URL`. The default is `http://localhost:3000`, the Backend's local port. This app listens on **3001** so both can run together.

Search, layers, and Standort-Eingaben send `Authorization: Bearer`. Anmelden and Registrieren store the JWT from `TokenResponse` in `sessionStorage` under `ruehrai.session`. **Abmelden** calls `POST /auth/logout` (revokes the token id) and then removes that record, returning to `/login`. If the revoke call fails, the browser token is still cleared.

Labels follow the UX gate: **Anmelden**, **Registrieren**, **Abmelden**, **Suche**, **Treffer**, **Layer**, **Musteranalyse**, **Zielregion**, **Noch keine Filialadressen**.

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
| Karte + Suche | `/` | `GET /layers/demo-gemeinden`, `GET /search`, `GET /stores`, `GET /target-region`, `GET /recommendations`. OpenAPI 0.5.0: Filialadressen use `lon`/`lat` (PLZ centroid when the write omits both) as Stecknadeln (Straße, PLZ Ort). Top-3 points use a separate mark. The Zielregion `geometry` (Polygon or MultiPolygon) is a translucent fill plus outline and the legend **Zielregion**. `bounds` (`west`, `south`, `east`, `north`) is unioned with the pins for fit (48px padding) on first open and when that data changes. An empty pair stays on a Germany overview. |
| Zielregion | `/standorte#zielregion` | Pick a Treffer from `GET /search`, then `PUT /target-region`. `GET` returns 404 until one is saved. |
| Filialadressen | `/standorte#filialadressen` | `GET/POST /stores`, `PUT/DELETE /stores/{id}`. |
| Umsatz | `/standorte#umsatz` | Last three years, Jahr and Monat, at most 36 points. `GET/PUT /stores/{id}/revenue`. Empty months are sent as `revenueEur: null` and marked **fehlend**. `0` is a stored value. |
| Musteranalyse | `/musteranalyse` | `GET /analysis/input`, `POST /analysis/runs`, `GET /analysis/runs/{id}`, `GET /analysis/pattern`. The page shows the input summary, Brain-Suche status (`vector` or SQL filter), and the derived pattern (Kurzfassung). After a pattern exists, **Empfehlungen** opens the Top-3 page. It does not call oMLX. |
| Empfehlungen | `/empfehlungen` | `GET /recommendations`, `POST /recommendations`. Shows **Top 3 in Ihrer Zielregion**, the pattern's Kurzkriterien, and cards with Rang, Adresse, Begründung, and Details. Fewer than three matches show the thin-region hint plus the Backend `reason`. |

These calls use [`@ruehrai/api-contracts`](../../packages/api-contracts/README.md) from this repo. There is no client fixture and no separate copy of the OpenAPI document. A missing Backend shows an error, not Demo-Daten.

To point at another API:

```bash
NEXT_PUBLIC_API_BASE_URL=https://api.example.com pnpm --filter @ruehrai/web dev
```

`NEXT_PUBLIC_*` is baked in at build time. Set it before `pnpm --filter @ruehrai/web build` for a deployed bundle.

STAGE on the public edge `http://217.160.164.239` uses a same-origin base so the browser talks to nginx on Ubuntu, which proxies to Nest on Eule:

```bash
NEXT_PUBLIC_API_BASE_URL=/api
```

An empty value is also relative (requests go to the site root). Do not put a Tailscale address in `NEXT_PUBLIC_*`.

`pnpm install` copies the MapLibre worker into `apps/web/public/maplibre` (gitignored). The map loads that file because the Next bundler does not expose the worker as a JavaScript module.

## Checks

```bash
pnpm --filter @ruehrai/web lint
pnpm --filter @ruehrai/web typecheck
pnpm --filter @ruehrai/web test
pnpm --filter @ruehrai/web build
```

`typecheck` and `build` compile `@ruehrai/api-contracts` first. The web tests cover URL building, the bearer header, login/register/logout, the Standort paths, and the Umsatz rules (missing month vs. zero, Jahr/Monat, three years). They do not start the Backend.

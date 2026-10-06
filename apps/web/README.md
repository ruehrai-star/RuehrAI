# RuehrAI Web

Map, search, and Standort-Eingaben for Standortberatung. The UI calls the Backend through `lib/api`, typed with [`@ruehrai/api-contracts`](../../packages/api-contracts/README.md). There is no in-process mock on the happy path, and no Supabase client. If a call cannot reach the Backend, the screen shows the error. Client fixtures are not substituted for live responses; anything that is only demo data must be labeled **Demo-Daten**.

`GET /search`, `GET /layers/{id}`, `POST /auth/login`, and `POST /auth/register` go to `NEXT_PUBLIC_API_BASE_URL`. The default is `http://localhost:3000`, the Backend's local port. This app listens on **3001** so both can run together.

Search, layers, and Standort-Eingaben send `Authorization: Bearer`. Anmelden and Registrieren store the JWT from `TokenResponse` in `sessionStorage` under `ruehrai.session`. **Abmelden** calls `POST /auth/logout` (revokes the token id) and then removes that record, returning to `/login`. If the revoke call fails, the browser token is still cleared.

Labels follow the UX gate: **Anmelden**, **Registrieren**, **Abmelden**, **Suche**, **Treffer**, **Layer**, **Musteranalyse**, **Zielregion**, **Noch keine Filialadressen**.

Ebene vs Flächenart (Quartier / Planungsraum) and async run polling: [`docs/ebenen.md`](docs/ebenen.md).

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
| Registrieren | `/register` | `POST /auth/register` (201, JWT). New accounts have no Standorte and open `/standorte`. |
| Anmelden | `/login` | `POST /auth/login`. With stores or Zielregionen the app opens `/verlauf`; otherwise `/standorte`. Invalid credentials stay on the form with an error. |
| Abmelden | header | Clears `sessionStorage` and opens `/login`. |
| Einstieg | `/` | Signed-in root: `GET /stores` and `GET /target-region`. Either list non-empty → `/verlauf`, both empty → `/standorte`. Signed out → `/karte`. |
| Karte + Suche | `/karte` | `GET /layers/demo-gemeinden`, `GET /search`, `GET /stores`, `GET /target-region`, `GET /recommendations`. OpenAPI 0.5.0: Filialadressen use `lon`/`lat` (PLZ centroid when the write omits both) as Stecknadeln (Straße, PLZ Ort). Top-3 points use a separate mark. The Zielregion `geometry` (Polygon or MultiPolygon) is a translucent fill plus outline and the legend **Zielregion**. `bounds` (`west`, `south`, `east`, `north`) is unioned with the pins for fit (48px padding) on first open and when that data changes. An empty pair stays on a Germany overview. The map stays in the nav; it is not the signed-in entry. |
| Zielregion | `/standorte#zielregion` | Pick a Treffer from `GET /search`, then `PUT /target-region`. The picker sends the place id (`geoKey`, `ags` or `plz`) and coordinates, not a polygon. The outline comes from Brain `app.map_features`, then Data-Scout `geo_ref_bezirk` / `geo_ref_admin` (Location-Guide). A Berlin Bezirk alias such as `11006006` is stored as `11000006`. `GET` returns 404 until one is saved. `PUT` returns 400 when no catalog area exists and the hit has no coordinates. |
| Filialadressen | `/standorte#filialadressen` | `GET/POST /stores`, `PUT/DELETE /stores/{id}`. |
| Umsatz | `/standorte#umsatz` | Last three years, Jahr and Monat, at most 36 points. `GET/PUT /stores/{id}/revenue`. Empty months are sent as `revenueEur: null` and marked **fehlend**. `0` is a stored value. |
| Verlauf | `/verlauf` | After Standorte the app opens Verlauf, not the map. Hero is `AnalysisPattern.yearlySeries` (OpenAPI 0.8.0): three-year Kleinraum change and the derived next step. `coverage` `single` or `none` is not a trend. Absent points show **liegt nicht vor**. `sourceLevel` ≠ `requestedLevel` is labeled as Gemeinde-/Kreiswerte. Store revenue stays optional and is not part of `yearlySeries`. The smaller map is a proof overlay (Polygon/MultiPolygon only, no `demo-gemeinden`). |
| Musteranalyse | `/musteranalyse` | `GET /analysis/input`, `POST /analysis/runs` (202 `queued`), `GET /analysis/runs/{id}` (`queued` / `running` / `completed` / `failed`), `GET /analysis/pattern`. The page shows the input summary, Brain-Suche status (`vector` or SQL filter), and the derived pattern (Kurzfassung). After a pattern exists, **Verlauf** and **Empfehlungen** stay available. It does not call oMLX. **Analyse starten** stays disabled while a run is queued or running, with the same start lock as Empfehlungen. Polling is documented in [`docs/ebenen.md`](docs/ebenen.md). |
| Empfehlungen | `/empfehlungen` | `GET /recommendations?runId=` after a completed run. The heading is always **Top 3 in Ihrer Zielregion [markierte Region]** (singular, currently marked Zielregion). The collapsed `X (Stadt) + N weitere` run label belongs only on the Stand line. Cards show Rang, Adresse, Begründung, and Details. Fewer than three matches show the thin-region hint plus the Backend `reason`. **Musteranalyse starten** / **Erneut starten** stay disabled while a run is `queued` or `running`. A bind/load error uses a neutral sentence plus **Erneut versuchen**, not **Analyse fehlgeschlagen**. |

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

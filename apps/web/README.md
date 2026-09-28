# RuehrAI Web

Map and search shell for Standortberatung. The UI talks to the Backend only through `lib/api`. That module is an in-process mock of the v0 HTTP contract until `packages/api-contracts` publishes a generated OpenAPI client. Swap the implementation in `createRuehrApi` (`lib/api/index.ts`); components stay on the `RuehrApi` interface.

There is no Supabase client. Login is a stub for a Backend JWT session (`POST /auth/login`), not a third-party auth provider.

## Run

From `apps/web`:

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000.

The map loads mock layer `grid100` (synthetic 100 m cells near Friedrichshafen, inside the southern smoke band). Search by address, AGS, or PLZ, then choose a hit to fly there.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Mock contract

| Method | Path | Client |
| --- | --- | --- |
| GET | `/health` | `health()` |
| GET | `/search?q=` | `search(query)` |
| GET | `/layers/{id}` | `getLayer(id)` |
| POST | `/auth/login` | `login({ email, password })` |
| POST | `/auth/logout` | `logout()` |

`GET /search` returns `{ query, results: [{ id, label, grain, lon?, lat? }] }`. Grains follow the Datenbasis list: `address`, `grid100`, `plz8`, `plz5`, `ags`, `other`. `GET /layers/grid100` returns a GeoJSON `FeatureCollection`. Any other layer id is a 404.

`NEXT_PUBLIC_API_MODE` defaults to `mock`. Another value throws until the OpenAPI adapter is wired.

Fixtures are illustrative. Grid ids use the documented `CRS3035RES100mN…E…` shape and are not surveyed Zensus cells. PLZ8 values are synthetic. The login token is unsigned (`alg: none`, signature `mock`) and lives only in `sessionStorage`.

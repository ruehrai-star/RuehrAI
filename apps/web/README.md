# RuehrAI Web

Map and search shell for Standortberatung. The UI calls the Backend through `lib/api`, typed with [`@ruehrai/api-contracts`](../../packages/api-contracts/README.md). There is no in-process mock on the happy path, and no Supabase client.

`GET /search`, `GET /layers/{id}`, and `POST /auth/login` go to `NEXT_PUBLIC_API_BASE_URL`. The default is `http://localhost:3000`, the Backend's local port. This app listens on **3001** so both can run together.

Search and layers send `Authorization: Bearer`. Login stores the JWT from `TokenResponse` in `sessionStorage`. The contract has no logout route; Abmelden only clears that record.

## Run

Start the Backend first (see [`apps/backend/README.md`](../backend/README.md)): Postgres, `pnpm db:migrate`, `pnpm start:dev`. Seed login: `dev@ruehrai.local` / `dev-password`.

From the repo root:

```bash
pnpm install
pnpm --filter @ruehrai/web dev
```

Open http://localhost:3001 and sign in. The map loads layer `demo-gemeinden`.

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

`typecheck` and `build` compile `@ruehrai/api-contracts` first. The web tests cover URL building, the bearer header, and parsing of the OpenAPI responses. They do not start the Backend.

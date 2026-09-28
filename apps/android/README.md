# RuehrAI Standortberatung — Android shell

Kotlin and Jetpack Compose shell for the Standortberatung client. The map uses MapLibre Native Android. Auth, search, and layers call the Backend through a Kotlin client generated from the shared OpenAPI v0 contract. There is no Supabase SDK in this app. The Backend issues its own JWT; the client sends `Authorization: Bearer`.

## Contract

The spec is the shared package, not a copy under `apps/android`:

- `packages/api-contracts/openapi/openapi.yaml`
- `packages/api-contracts/openapi/openapi.json`

`apps/android` runs OpenAPI Generator (`kotlin`, OkHttp 4, Moshi) during `preBuild`. Generated sources land in `app/build/generated/openapi` (package `de.ruehrai.api`) and are not committed. Gradle reads the YAML from the monorepo path above, so this directory has to be opened as `apps/android` inside the RuehrAI checkout.

That contract currently arrives with Backend PR #6 (`cursor/backend-api-scaffold-dd3e`). This branch vendors the same `packages/api-contracts` tree so the Android build does not wait for that PR to merge.

## Open in Android Studio

Open the `apps/android` directory, not the monorepo root.

You need JDK 17 or newer and Android SDK 36 (build-tools 35.0.0 is enough).

## Build from the command line

```bash
cd apps/android
./gradlew testDebugUnitTest lintDebug assembleDebug
```

`local.properties` is gitignored. Point it at your SDK if Gradle does not see `ANDROID_HOME`:

```properties
sdk.dir=/path/to/Android/sdk
```

Debug builds use the debug keystore. Release signing is intentionally not set up.

Build-time defaults (also overridable at runtime, see below):

| Gradle property | Default | Meaning |
| --- | --- | --- |
| `ruehrai.apiBaseUrl` | `http://10.0.2.2:3000` | Base URL baked into `BuildConfig.API_BASE_URL`. `10.0.2.2` is the emulator alias for the host machine's `localhost`. |
| `ruehrai.useMockApi` | `false` | `true` starts on the offline mock. The live client is the primary path. |

```bash
./gradlew assembleDebug -Pruehrai.apiBaseUrl=http://10.0.2.2:3000 -Pruehrai.useMockApi=false
```

## Pointing at a local Backend

The OpenAPI server URL is `http://localhost:3000`. From the Android emulator that host is `http://10.0.2.2:3000` (the app default). A device on the same LAN needs the computer's LAN address, for example `http://192.168.1.20:3000`.

Debug builds allow cleartext HTTP. Release builds stay HTTPS-only.

On the login screen, with **Demo-Daten** off:

1. Set the base URL (prefilled from `BuildConfig`).
2. The health line calls `GET /health`.
3. Sign in with the seeded local user from the contract: `dev@ruehrai.local` / `dev-password`. That account is a local fixture, not a production credential.
4. **Konto anlegen** calls `POST /auth/register` (password 8–72 characters).

The session token stays in memory. Nothing in this app talks to Supabase.

## Mock vs live

`StandortApiFactory` uses `OpenApiStandortApi` unless `ApiSettings.useMock` is true. The login switch **Demo-Daten** writes that flag to `SharedPreferences` (`standort-api`) and overrides the Gradle default for later launches. Turn it on when the Backend is down; the mock serves the same schemas and the Backend seed layer ids (`demo-gemeinden`, `demo-plz`, `demo-grid100`). Mock login accepts any `name@host.tld` and a password of at least 8 characters and returns `mock-session-token`.

| Call | Live client |
| --- | --- |
| `GET /health` | Liveness. Optional; shown on the login screen. |
| `POST /auth/login` | Body `Credentials` `{ "email", "password" }`. `TokenResponse` uses camelCase: `accessToken`, `tokenType` (`Bearer`), `expiresIn`. |
| `POST /auth/register` | Same body. `201` plus a token, `409` if the email exists. |
| `GET /auth/me` | Current `User` (`id`, `email`) with the bearer token. |
| `GET /search` | Query params `q`, `type` (`address` \| `ags` \| `plz`), `address`, `ags`, `plz`, `geoKey`, `grain`. Response `{ "hits": SearchHit[] }` with `id`, `label`, `grain`, optional `geoKey`, `lon`, `lat`. |
| `GET /layers/{id}` | GeoJSON `FeatureCollection`. Seed ids: `demo-gemeinden`, `demo-plz`, `demo-grid100`. Geometries are synthetic stubs. |

Search and layer payloads are stored in a Room cache (`standort-cache.db`) as Moshi JSON. That cache is a stub, not an offline product. Auth is not cached.

## Screens

1. **Anmelden** — live JWT login against the configured base URL, or the offline mock.
2. **Karte** — MapLibre map. The basemap is the public demo style (`https://demotiles.maplibre.org/style.json`), so tiles need a network connection. Layer chips load `demo-gemeinden`, `demo-plz`, and `demo-grid100`.
3. **Suche** — free text plus optional type chips (Alle / Adresse / AGS / PLZ). A hit with coordinates moves the camera.

## CI

`.github/workflows/android.yml` runs `lintDebug`, `testDebugUnitTest`, and `assembleDebug` on changes under `apps/android` or `packages/api-contracts`.

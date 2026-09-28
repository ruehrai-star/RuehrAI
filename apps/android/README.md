# RuehrAI Standortberatung — Android shell

Kotlin and Jetpack Compose shell for the Standortberatung client. The map uses MapLibre Native Android. Auth, search, and layers talk to a local mock of the Backend OpenAPI v0 slice. There is no Supabase SDK in this app.

`packages/api-contracts` is not in the repo yet. Do not generate an OpenAPI client until Backend lands OpenAPI v0. The switch lives in `StandortApiFactory`.

## Open in Android Studio

Open the `apps/android` directory (this folder), not the monorepo root. Android Studio will use the Gradle wrapper.

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

## Screens

1. **Anmelden** — placeholder for `POST /auth/login`. Any email shaped like `name@host.tld` and a password of at least 8 characters returns a fake Bearer session. Nothing is sent over the network, and the token is kept in memory only.
2. **Karte** — MapLibre map centered on the Ruhr area. The basemap is the public MapLibre demo style (`https://demotiles.maplibre.org/style.json`), so the device needs a network connection for tiles. Area overlays come from the local layer mock.
3. **Suche** — query field for address, AGS, or PLZ. Choosing a hit moves the map camera and draws a point.

## Mocked endpoints

| Call | Mock behavior |
| --- | --- |
| `POST /auth/login` | JSON body `{ "email", "password" }`. Success returns `{ "access_token", "token_type": "Bearer", "expires_in" }`. Invalid input returns an auth error. |
| `GET /search?q=` | Hits with `kind` of `address`, `ags`, or `plz` (label, subtitle, coordinates, optional `ags` and `plz`). Blank queries return no hits. |
| `GET /layers/{id}` | `ruhr-gemeinden` returns a GeoJSON `FeatureCollection` (schematic boxes for Essen, Dortmund, and Duisburg, not official boundaries). Other ids fail. |

Successful search and layer responses are written through a small Room cache (`standort-cache.db`) so the shell has a local-cache hook. That cache is a stub, not an offline product.

## Replacing the mock

`de.ruehrai.standort.data.api.StandortApi` is the contract. `StandortApiFactory` returns `MockStandortApi` today. `OpenApiStandortApi` throws until a client is generated from `packages/api-contracts` and bound in the factory (`StandortApiMode.OPENAPI`).

## CI

`.github/workflows/android.yml` runs `lintDebug`, `testDebugUnitTest`, and `assembleDebug` on changes under `apps/android`.

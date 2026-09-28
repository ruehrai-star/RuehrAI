# RuehrAI iOS

Native shell for the first client slice. SwiftUI on iOS 17+, MapLibre Native for the map, and a typed Backend client generated from the shared OpenAPI document. The app does not talk to Supabase and does not link `supabase-swift` or any other Supabase SDK.

This repository is edited on Linux. `xcodebuild` is not expected to succeed here. On a Mac, XcodeGen turns `project.yml` into an Xcode project.

## Open and build on a Mac

Requirements: Xcode 16.3 or newer (Swift 6.1, iOS 17 SDK), and [XcodeGen](https://github.com/yonaskolb/XcodeGen). The OpenAPI packages declare `swift-tools-version: 6.1`.

```sh
brew install xcodegen
cd apps/ios
xcodegen generate
open RuehrAI.xcodeproj
```

Run the `RuehrAI` scheme on an iPhone simulator. `project.yml` is the source of truth. The generated `RuehrAI.xcodeproj` is gitignored.

Device builds need an Apple Development Team in Signing & Capabilities. Simulator builds can stay unsigned:

```sh
xcodebuild \
  -project RuehrAI.xcodeproj \
  -scheme RuehrAI \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

The map package is [MapLibre Native for iOS](https://github.com/maplibre/maplibre-gl-native-distribution) **6.31.0** (product `MapLibre`). It is an iOS binary. Linux cannot link it. The SwiftUI wrapper is `Sources/Map/MapLibreMapView.swift`.

## Codegen

OpenAPI v0 on `main` is the source of truth: [`packages/api-contracts/openapi/openapi.yaml`](../../packages/api-contracts/openapi/openapi.yaml). The Swift package `apps/ios/Packages/RuehrAPI` does not keep a copy. `Sources/RuehrAPI/openapi.yaml` is a symlink to that file. `openapi-generator-config.yaml` next to it asks the SwiftPM build plugin for public types and a client (`namingStrategy: idiomatic`).

| Package | Version |
| --- | --- |
| [swift-openapi-generator](https://github.com/apple/swift-openapi-generator) | 1.13.1 |
| [swift-openapi-runtime](https://github.com/apple/swift-openapi-runtime) | 1.12.1 |
| [swift-openapi-urlsession](https://github.com/apple/swift-openapi-urlsession) | 1.3.1 (app target only) |

Xcode and `swift build` run the `OpenAPIGenerator` plugin and write `Client.swift` and the schema types into the build folder. Those files are not committed. After a contract change, rebuild `RuehrAPI`. The first build downloads the generator.

Generated calls used by the shell:

| Operation | Method and path |
| --- | --- |
| `getHealth` | `GET /health` |
| `login` | `POST /auth/login` |
| `register` | `POST /auth/register` |
| `getCurrentUser` | `GET /auth/me` |
| `searchPlaces` | `GET /search` |
| `getLayer` | `GET /layers/{id}` |

`URLSessionTransport` performs live HTTP. `FixtureTransport` implements the same `ClientTransport` and returns contract JSON without opening a socket.

## Backend base URL

The document's local server is `http://localhost:3000`. The app reads `RUEHR_API_BASE_URL` in this order:

1. Process environment (Xcode scheme → Run → Arguments → Environment Variables).
2. The `RUEHR_API_BASE_URL` key in `Sources/Info.plist` (empty by default).

An empty value selects the fixture. A URL selects the live client.

```sh
# Simulator, Backend on the same Mac
RUEHR_API_BASE_URL=http://localhost:3000
```

`NSAllowsLocalNetworking` is set so a local `http` Backend is allowed. On a device, point the variable at the Mac's LAN address. The iOS Simulator shares the Mac's loopback, so `localhost:3000` reaches a Backend on that Mac.

The contract's local seed user is `dev@ruehrai.local` / `dev-password`. That account is a development fixture in the Backend migrations, not a production credential. Passwords are 8 to 72 characters. The app stores the returned access token in memory only. It does not use the Keychain and it does not embed a Supabase client.

## What the shell does

1. **Sign in.** The primary button calls `POST /auth/login` and stores the returned Bearer token in memory. Create account calls `POST /auth/register`. Either success is followed by `GET /auth/me`. Sign out drops the token. Against a live Backend the token is the JWT from that response. The local seed user in the contract is `dev@ruehrai.local` / `dev-password`. Fixture mode (no base URL) accepts any plausible email and any password of 8 to 72 characters and returns a `stub-session-` string with no dots, not a JWT.
2. **Map.** Opens centered on Germany. The basemap is the keyless [OpenFreeMap Liberty](https://tiles.openfreemap.org/styles/liberty) style (OpenStreetMap data). Leave the MapLibre logo and attribution button visible.
3. **Layers.** A control switches the seeded ids `demo-gemeinden`, `demo-plz`, and `demo-grid100` and calls `GET /layers/{id}`. The grid layer draws a schematic rectangle for the documented Zensus 2022 100 m smoke band. It is not an official boundary. Gemeinde and PLZ layers are points.
4. **Search.** The field calls `GET /search?q=`. Hits use the contract `grain` (`address`, `ags`, `plz5`, …). A tap centers the map when `lat` and `lon` are present (address zoom 15, PLZ 13, AGS 10). `Baden-Württemberg` has no point in the fixture, so the tap only explains that.

`GET /health` runs when the map appears. The status bar shows `Fixture ok` or `Backend ok` when the body is `{ "status": "ok" }`. Search and layers send `Authorization: Bearer` from the in-memory token. Health, login, and register do not.

## Contract paths

The generated client is the only caller. The fixture answers the same operations so the UI still runs while the API is down.

`GET /health` — no auth. `200` body `{ "status": "ok" }`.

`POST /auth/login` and `POST /auth/register` — JSON `{ "email", "password" }`. Login returns `200` and register `201` with `{ "accessToken", "tokenType": "Bearer", "expiresIn" }`. Wrong credentials are `401` on the live Backend. A duplicate email is `409`.

`GET /auth/me` — current user `{ "id", "email" }`.

`GET /search` — query `q`, plus optional `type`, `address`, `ags`, `plz`, `geoKey`, and `grain`. Response `{ "hits": [ { "id", "label", "grain", "geoKey", "lon", "lat" } ] }`. Coordinates are WGS84 (EPSG:4326) and may be null. At most 50 hits.

`GET /layers/{id}` — GeoJSON `FeatureCollection` (`name` and `description` included). Unknown ids are `404`.

## Tests

```sh
cd apps/ios/Packages/RuehrAPI
swift test
```

The tests drive the generated client through `FixtureTransport` and check the HTTP paths (`/health`, `/auth/login`, `/auth/me`, `/search`, `/layers/demo-grid100`). They need network the first time, to fetch the generator. They do not need a running Backend.

On a Mac, the `RuehrAI` scheme also lists `RuehrAPITests` (Product → Test, or `swift test` as above).

## CI

[`.github/workflows/ios.yml`](../../.github/workflows/ios.yml) runs on macOS:

- `swift test` for `RuehrAPI`
- `xcodegen generate` so `project.yml` stays valid

An unsigned `xcodebuild` is not run yet. It waits until an Apple Development Team is configured.

## Layout

```
apps/ios/
  project.yml
  Sources/
    App/          entry, theme, Backend base URL
    Auth/         login and in-memory session
    Map/          SwiftUI map screen and MapLibre wrapper
    Info.plist    empty RUEHR_API_BASE_URL, local HTTP allowed
  Packages/RuehrAPI/
    Sources/RuehrAPI/openapi.yaml   symlink to packages/api-contracts
    Sources/RuehrAPI/FixtureTransport.swift
```

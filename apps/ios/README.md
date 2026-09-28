# RuehrAI iOS

Native shell for the first client slice. SwiftUI on iOS 17+, MapLibre Native for the map, and an in-memory stand-in for the Backend. The app does not talk to Supabase and does not link `supabase-swift` or any other Supabase SDK.

This repository is edited on Linux. `xcodebuild` is not expected to succeed here. On a Mac, XcodeGen turns `project.yml` into an Xcode project.

## Open and build on a Mac

Requirements: Xcode 16 or newer (iOS 17 SDK), and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

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

## What the shell does

1. **Sign in.** Any plausible email and any non-empty password are accepted, for example `analyst@ruehrai.example` and `password`. The check is local. The password is not stored. The session token is an in-memory string prefixed with `stub-session-`. It is not a JWT, it is not written to disk, and it must not be sent to a real Backend. Sign out clears it. A later slice will call the Backend login endpoint.
2. **Map.** Opens centered on Germany. The basemap is the keyless [OpenFreeMap Liberty](https://tiles.openfreemap.org/styles/liberty) style (OpenStreetMap data). Leave the MapLibre logo and attribution button visible.
3. **Layer.** On launch the app calls `GET /layers/de-sample` and draws the GeoJSON. The southern rectangle is a schematic stand-in for the documented Zensus 2022 100 m smoke band, not an official boundary. Points mark Berlin, München, Hamburg, and Köln.
4. **Search.** The field calls `GET /search?q=` against the mock. Hits are `address`, `ags`, or `plz`. A tap centers the map when `lat` and `lon` are present (address zoom 15, PLZ 13, AGS 10). `Baden-Württemberg (AGS 08)` has no point, so the tap only explains that.

`GET /health` is called on launch. The status bar shows `Backend mock ok` when the stub returns `{ "status": "ok" }`.

## Mock API contract

`Packages/RuehrAIAPI` is the contract stand-in until `packages/api-contracts` publishes OpenAPI v0. Replace `MockAPIClient` with a `swift-openapi-generator` client behind `RuehrAPIClient`. Keep calling the Backend. Do not point the app at Supabase.

Responses are WGS84 (EPSG:4326), which is what GeoJSON and MapLibre expect. Stored polygons in the data platform use EPSG:3035; the Backend is expected to reproject before it serves `/layers/{id}`.

### `GET /health`

```json
{ "status": "ok" }
```

### `GET /search?q={query}`

JSON array. `kind` is `address`, `ags`, or `plz`. Omit `lat` and `lon` when there is no point.

```json
[
  {
    "id": "plz-10115",
    "label": "10115 Berlin",
    "kind": "plz",
    "lat": 52.5326,
    "lon": 13.387
  }
]
```

Matching is case-insensitive and folds `ä/ae`, `ö/oe`, `ü/ue`, and `ß/ss`. A blank query is an error. Unknown text returns an empty array.

### `GET /layers/{id}`

GeoJSON `FeatureCollection`. The mock serves `de-sample` only. Any other id fails.

Paths are documented on `APIRoutes` (`/health`, `/search?q=`, `/layers/{id}`). The mock does not open a connection.

## Tests

The mock package is Foundation-only, so it tests on Linux and on a Mac:

```sh
cd apps/ios/Packages/RuehrAIAPI
swift test
```

On a Mac, the `RuehrAI` scheme also lists `RuehrAIAPITests` (Product → Test, or `swift test` as above).

## CI

[`.github/workflows/ios.yml`](../../.github/workflows/ios.yml) runs on `macos-latest` when `apps/ios` changes:

- `swift test` for `RuehrAIAPI`
- `xcodegen generate` so `project.yml` stays valid
- `xcodebuild` is **not** run yet. Unsigned simulator builds stay deferred until a development team is chosen. The command is in the workflow log and in the section above.

No secrets, certificates, or provisioning profiles are stored in this repo.

## Layout

```
apps/ios/
  project.yml                 XcodeGen spec
  Sources/                    SwiftUI app
  Packages/RuehrAIAPI/        models, mock client, stub sign-in, tests
```

## Not in this slice

- Generated OpenAPI client (`packages/api-contracts` is not in the repo yet)
- Real Backend login, Keychain storage, or token refresh
- Supabase
- Offline tiles or official boundaries

import Foundation

/// Stub Backend for the iOS shell.
///
/// - `GET /health` → `{ "status": "ok" }`
/// - `GET /search?q=` → hits with `id`, `label`, `kind` (`address` | `ags` | `plz`), optional `lat` / `lon`
/// - `GET /layers/{id}` → a GeoJSON `FeatureCollection` in WGS84
///
/// Polygons in the data platform are stored in EPSG:3035. This client already
/// speaks the map contract: GeoJSON positions are longitude/latitude in EPSG:4326.
/// The southern polygon is a schematic stand-in for the documented Zensus 2022
/// 100 m smoke band, not an official boundary.
public struct MockAPIClient: RuehrAPIClient {
    public static let sampleLayerID = "de-sample"

    public static let catalog: [SearchHit] = [
        SearchHit(
            id: "addr-10115-invalidenstr-117",
            label: "Invalidenstraße 117, 10115 Berlin",
            kind: .address,
            lat: 52.5305,
            lon: 13.3808
        ),
        SearchHit(
            id: "addr-80331-marienplatz-1",
            label: "Marienplatz 1, 80331 München",
            kind: .address,
            lat: 48.1374,
            lon: 11.5755
        ),
        SearchHit(
            id: "addr-20095-rathausmarkt-1",
            label: "Rathausmarkt 1, 20095 Hamburg",
            kind: .address,
            lat: 53.5503,
            lon: 9.9922
        ),
        SearchHit(
            id: "ags-11000000",
            label: "Berlin (AGS 11000000)",
            kind: .ags,
            lat: 52.5200,
            lon: 13.4050
        ),
        SearchHit(
            id: "ags-09162000",
            label: "München (AGS 09162000)",
            kind: .ags,
            lat: 48.1372,
            lon: 11.5755
        ),
        SearchHit(
            id: "ags-02000000",
            label: "Hamburg (AGS 02000000)",
            kind: .ags,
            lat: 53.5511,
            lon: 9.9937
        ),
        SearchHit(
            id: "ags-05315000",
            label: "Köln (AGS 05315000)",
            kind: .ags,
            lat: 50.9375,
            lon: 6.9603
        ),
        SearchHit(
            id: "ags-08",
            label: "Baden-Württemberg (AGS 08)",
            kind: .ags
        ),
        SearchHit(
            id: "plz-10115",
            label: "10115 Berlin",
            kind: .plz,
            lat: 52.5326,
            lon: 13.3870
        ),
        SearchHit(
            id: "plz-80331",
            label: "80331 München",
            kind: .plz,
            lat: 48.1340,
            lon: 11.5740
        ),
        SearchHit(
            id: "plz-20095",
            label: "20095 Hamburg",
            kind: .plz,
            lat: 53.5520,
            lon: 9.9950
        ),
        SearchHit(
            id: "plz-50667",
            label: "50667 Köln",
            kind: .plz,
            lat: 50.9370,
            lon: 6.9580
        ),
    ]

    public init() {}

    public func health() async throws -> HealthResponse {
        HealthResponse(status: "ok")
    }

    public func search(query: String) async throws -> [SearchHit] {
        let needle = Self.fold(query)
        guard !needle.isEmpty else {
            throw APIError.emptyQuery
        }
        return Self.catalog
            .filter { hit in
                Self.fold(hit.label).contains(needle)
                    || Self.fold(hit.id).contains(needle)
                    || hit.kind.rawValue.contains(needle)
            }
            .sorted { lhs, rhs in
                let leftRank = Self.rank(lhs, needle: needle)
                let rightRank = Self.rank(rhs, needle: needle)
                if leftRank != rightRank {
                    return leftRank < rightRank
                }
                return Self.fold(lhs.label) < Self.fold(rhs.label)
            }
    }

    public func layer(id: String) async throws -> GeoJSONFeatureCollection {
        guard id == Self.sampleLayerID else {
            throw APIError.unknownLayer(id)
        }
        return Self.sampleLayer()
    }

    private static func rank(_ hit: SearchHit, needle: String) -> Int {
        let label = fold(hit.label)
        let id = fold(hit.id)
        if label.hasPrefix(needle) || id.hasPrefix(needle) {
            return 0
        }
        return 1
    }

    /// Case- and diacritic-insensitive match, including ae/oe/ue/ss spellings.
    private static func fold(_ value: String) -> String {
        var folded = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let digraphs = [
            "ae": "ä",
            "oe": "ö",
            "ue": "ü",
        ]
        for (from, to) in digraphs {
            folded = folded.replacingOccurrences(of: from, with: to)
        }
        let letters = [
            "ä": "a",
            "ö": "o",
            "ü": "u",
            "ß": "ss",
        ]
        for (from, to) in letters {
            folded = folded.replacingOccurrences(of: from, with: to)
        }
        return folded
    }

    private static func sampleLayer() -> GeoJSONFeatureCollection {
        let smokeRing = [
            GeoJSONPosition(longitude: 7.5, latitude: 47.3),
            GeoJSONPosition(longitude: 13.1, latitude: 47.3),
            GeoJSONPosition(longitude: 13.1, latitude: 47.7),
            GeoJSONPosition(longitude: 7.5, latitude: 47.7),
            GeoJSONPosition(longitude: 7.5, latitude: 47.3),
        ]
        let places: [(String, String, Double, Double)] = [
            ("berlin", "Berlin", 13.4050, 52.5200),
            ("muenchen", "München", 11.5755, 48.1372),
            ("hamburg", "Hamburg", 9.9937, 53.5511),
            ("koeln", "Köln", 6.9603, 50.9375),
        ]
        var features = [
            GeoJSONFeature(
                id: "smoke-extent",
                geometry: .polygon([smokeRing]),
                properties: [
                    "name": "Schematic southern grid smoke extent",
                    "kind": "grid100-extent",
                    "note": "Mock rectangle for the documented Zensus 2022 100 m smoke band. Not an official boundary.",
                ]
            ),
        ]
        features.append(contentsOf: places.map { id, name, longitude, latitude in
            GeoJSONFeature(
                id: id,
                geometry: .point(GeoJSONPosition(longitude: longitude, latitude: latitude)),
                properties: [
                    "name": name,
                    "kind": "place",
                ]
            )
        })
        return GeoJSONFeatureCollection(features: features)
    }
}

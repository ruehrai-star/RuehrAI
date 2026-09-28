import Foundation

public struct GeoJSONPosition: Equatable, Sendable {
    public var longitude: Double
    public var latitude: Double

    public init(longitude: Double, latitude: Double) {
        self.longitude = longitude
        self.latitude = latitude
    }
}

public enum GeoJSONGeometry: Equatable, Sendable {
    case point(GeoJSONPosition)
    case lineString([GeoJSONPosition])
    case polygon([[GeoJSONPosition]])
}

public struct GeoJSONFeature: Equatable, Sendable {
    public var type: String
    public var id: String
    public var geometry: GeoJSONGeometry
    public var properties: [String: String]

    public init(id: String, geometry: GeoJSONGeometry, properties: [String: String]) {
        self.type = "Feature"
        self.id = id
        self.geometry = geometry
        self.properties = properties
    }
}

public struct GeoJSONFeatureCollection: Equatable, Sendable {
    public var type: String
    public var features: [GeoJSONFeature]

    public init(features: [GeoJSONFeature]) {
        self.type = "FeatureCollection"
        self.features = features
    }

    public func jsonData() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(self)
    }
}

extension GeoJSONFeatureCollection: Codable {
    private enum CodingKeys: String, CodingKey {
        case type
        case features
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "FeatureCollection" else {
            throw DecodingError.dataCorruptedError(
                forKey: .type,
                in: container,
                debugDescription: "Expected FeatureCollection."
            )
        }
        self.type = type
        self.features = try container.decode([GeoJSONFeature].self, forKey: .features)
    }
}

extension GeoJSONFeature: Codable {
    private enum CodingKeys: String, CodingKey {
        case type
        case id
        case geometry
        case properties
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "Feature" else {
            throw DecodingError.dataCorruptedError(
                forKey: .type,
                in: container,
                debugDescription: "Expected Feature."
            )
        }
        self.type = type
        self.id = try container.decode(String.self, forKey: .id)
        self.geometry = try container.decode(GeoJSONGeometry.self, forKey: .geometry)
        self.properties = try container.decode([String: String].self, forKey: .properties)
    }
}

extension GeoJSONGeometry: Codable {
    private enum CodingKeys: String, CodingKey {
        case type
        case coordinates
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "Point":
            let values = try container.decode([Double].self, forKey: .coordinates)
            self = .point(try Self.position(from: values))
        case "LineString":
            let line = try container.decode([[Double]].self, forKey: .coordinates)
            self = .lineString(try line.map(Self.position(from:)))
        case "Polygon":
            let rings = try container.decode([[[Double]]].self, forKey: .coordinates)
            self = .polygon(try rings.map { ring in
                try ring.map(Self.position(from:))
            })
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type,
                in: container,
                debugDescription: "Unsupported GeoJSON geometry \(type)."
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .point(let position):
            try container.encode("Point", forKey: .type)
            try container.encode([position.longitude, position.latitude], forKey: .coordinates)
        case .lineString(let positions):
            try container.encode("LineString", forKey: .type)
            try container.encode(positions.map { [$0.longitude, $0.latitude] }, forKey: .coordinates)
        case .polygon(let rings):
            try container.encode("Polygon", forKey: .type)
            try container.encode(
                rings.map { ring in ring.map { [$0.longitude, $0.latitude] } },
                forKey: .coordinates
            )
        }
    }

    private static func position(from values: [Double]) throws -> GeoJSONPosition {
        guard values.count >= 2 else {
            throw DecodingError.dataCorrupted(
                .init(codingPath: [], debugDescription: "A position needs longitude and latitude.")
            )
        }
        return GeoJSONPosition(longitude: values[0], latitude: values[1])
    }
}

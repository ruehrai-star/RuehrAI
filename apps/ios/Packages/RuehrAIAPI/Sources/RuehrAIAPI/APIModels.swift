import Foundation

public struct HealthResponse: Codable, Equatable, Sendable {
    public let status: String

    public init(status: String) {
        self.status = status
    }
}

public enum SearchHitKind: String, Codable, Equatable, Sendable, CaseIterable {
    case address
    case ags
    case plz
}

public struct SearchHit: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let label: String
    public let kind: SearchHitKind
    public let lat: Double?
    public let lon: Double?

    public init(
        id: String,
        label: String,
        kind: SearchHitKind,
        lat: Double? = nil,
        lon: Double? = nil
    ) {
        self.id = id
        self.label = label
        self.kind = kind
        self.lat = lat
        self.lon = lon
    }

    /// WGS84 degrees. Missing when the Backend has no point for this hit.
    public var coordinate: (latitude: Double, longitude: Double)? {
        guard let lat, let lon else { return nil }
        return (lat, lon)
    }
}

public enum APIError: Error, Equatable, Sendable {
    case emptyQuery
    case unknownLayer(String)
}

extension APIError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .emptyQuery:
            return "Enter an address, AGS, or PLZ."
        case .unknownLayer(let id):
            return "No layer named \(id)."
        }
    }
}

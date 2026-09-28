import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Offline stand-in for the Backend. Responses match OpenAPI v0.
///
/// Fixture sign-in accepts any plausible email and any password of 8 to 72
/// characters. It does not check a user table and it does not mint a JWT.
/// A live `URLSession` transport is what talks to `POST /auth/login`.
public final class FixtureTransport: ClientTransport, @unchecked Sendable {
    public static let seededLayerIDs = ["demo-gemeinden", "demo-plz", "demo-grid100"]

    private let lock = NSLock()
    private var usersByToken: [String: Components.Schemas.User] = [:]
    private var tokensByEmail: [String: String] = [:]
    private var nextUserID = 1

    public init() {}

    public func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        switch operationID {
        case "getHealth":
            return json(.ok, #"{"status":"ok"}"#)
        case "login":
            return try await login(body)
        case "register":
            return try await register(body)
        case "getCurrentUser":
            return currentUser(request)
        case "searchPlaces":
            return try search(request)
        case "getLayer":
            return layer(request)
        default:
            return failure(status: .notFound, message: "Unknown operation \(operationID).", error: "Not Found")
        }
    }

    private func login(_ body: HTTPBody?) async throws -> (HTTPResponse, HTTPBody?) {
        let credentials: Components.Schemas.Credentials
        do {
            credentials = try await decodeCredentials(body)
        } catch {
            return failure(status: .badRequest, message: "Email and password are required.", error: "Bad Request")
        }
        if let message = validate(credentials) {
            return failure(status: .badRequest, message: message, error: "Bad Request")
        }
        let email = normalize(credentials.email)
        let token = lock.sync {
            if let existing = tokensByEmail[email] {
                return existing
            }
            let issued = "stub-session-\(UUID().uuidString)"
            let user = Components.Schemas.User(id: String(nextUserID), email: email)
            nextUserID += 1
            tokensByEmail[email] = issued
            usersByToken[issued] = user
            return issued
        }
        return try tokenResponse(token)
    }

    private func register(_ body: HTTPBody?) async throws -> (HTTPResponse, HTTPBody?) {
        let credentials: Components.Schemas.Credentials
        do {
            credentials = try await decodeCredentials(body)
        } catch {
            return failure(status: .badRequest, message: "Email and password are required.", error: "Bad Request")
        }
        if let message = validate(credentials) {
            return failure(status: .badRequest, message: message, error: "Bad Request")
        }
        let email = normalize(credentials.email)
        let issued: String? = lock.sync {
            if tokensByEmail[email] != nil {
                return nil
            }
            let token = "stub-session-\(UUID().uuidString)"
            let user = Components.Schemas.User(id: String(nextUserID), email: email)
            nextUserID += 1
            tokensByEmail[email] = token
            usersByToken[token] = user
            return token
        }
        guard let issued else {
            return failure(status: .conflict, message: "Email is already registered.", error: "Conflict")
        }
        return try tokenResponse(issued, status: .created)
    }

    private func currentUser(_ request: HTTPRequest) -> (HTTPResponse, HTTPBody?) {
        guard let token = bearer(from: request) else {
            return failure(status: .unauthorized, message: "Missing or invalid bearer token.", error: "Unauthorized")
        }
        let user = lock.sync { usersByToken[token] }
        guard let user else {
            return failure(status: .unauthorized, message: "Missing or invalid bearer token.", error: "Unauthorized")
        }
        return json(.ok, encoded(user))
    }

    private func search(_ request: HTTPRequest) throws -> (HTTPResponse, HTTPBody?) {
        guard bearer(from: request) != nil else {
            return failure(status: .unauthorized, message: "Missing or invalid bearer token.", error: "Unauthorized")
        }
        let items = queryItems(from: request)
        if let ags = items["ags"], !ags.isEmpty, ags.range(of: #"^[0-9]{2,8}$"#, options: .regularExpression) == nil {
            return failure(status: .badRequest, message: "ags must be 2 to 8 digits.", error: "Bad Request")
        }
        if let plz = items["plz"], !plz.isEmpty, plz.range(of: #"^[0-9]{5}([0-9]{3})?$"#, options: .regularExpression) == nil {
            return failure(status: .badRequest, message: "plz must be PLZ5 or PLZ8.", error: "Bad Request")
        }
        let hits = filteredHits(items)
        return json(.ok, encoded(Components.Schemas.SearchResponse(hits: hits)))
    }

    private func layer(_ request: HTTPRequest) -> (HTTPResponse, HTTPBody?) {
        guard bearer(from: request) != nil else {
            return failure(status: .unauthorized, message: "Missing or invalid bearer token.", error: "Unauthorized")
        }
        guard let id = layerID(from: request) else {
            return failure(status: .badRequest, message: "Layer id is missing.", error: "Bad Request")
        }
        guard id.range(of: #"^[a-z0-9][a-z0-9-]{0,63}$"#, options: .regularExpression) != nil else {
            return failure(status: .badRequest, message: "Layer id is not a valid path segment.", error: "Bad Request")
        }
        guard let payload = Self.layers[id] else {
            return failure(status: .notFound, message: "No layer named \(id).", error: "Not Found")
        }
        return json(.ok, payload)
    }

    private func filteredHits(_ items: [String: String]) -> [Components.Schemas.SearchHit] {
        var hits = Self.catalog
        if let ags = nonempty(items["ags"]) {
            hits = hits.filter { ($0.grain == .ags || $0.grain == .ags5) && $0.geoKey == ags }
        }
        if let plz = nonempty(items["plz"]) {
            hits = hits.filter { ($0.grain == .plz5 || $0.grain == .plz8) && $0.geoKey == plz }
        }
        if let geoKey = nonempty(items["geoKey"]) {
            hits = hits.filter { $0.geoKey == geoKey }
        }
        if let grain = nonempty(items["grain"]), let parsed = Components.Schemas.Grain(rawValue: grain) {
            hits = hits.filter { $0.grain == parsed }
        }
        if let address = nonempty(items["address"]) {
            let needle = fold(address)
            hits = hits.filter { fold($0.label).contains(needle) || fold($0.geoKey ?? "").contains(needle) }
        }
        if let q = nonempty(items["q"]) {
            let needle = fold(q)
            hits = hits.filter { hit in
                let text = fold(hit.label).contains(needle)
                    || fold(hit.geoKey ?? "").contains(needle)
                    || fold(hit.id).contains(needle)
                switch items["type"] {
                case "address":
                    return hit.grain == .address && text
                case "ags":
                    return (hit.grain == .ags || hit.grain == .ags5) && text
                case "plz":
                    return (hit.grain == .plz5 || hit.grain == .plz8) && text
                default:
                    return text
                }
            }
        }
        return Array(hits.sorted { fold($0.label) < fold($1.label) }.prefix(50))
    }

    private func validate(_ credentials: Components.Schemas.Credentials) -> String? {
        let email = normalize(credentials.email)
        if !isPlausibleEmail(email) {
            return "Enter an email address with a name and a domain."
        }
        if credentials.password.count < 8 || credentials.password.count > 72 {
            return "Password must be 8 to 72 characters."
        }
        return nil
    }

    private func normalize(_ email: String) -> String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private func isPlausibleEmail(_ email: String) -> Bool {
        let parts = email.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty, !parts[1].isEmpty else { return false }
        let domain = parts[1]
        return domain.contains(".") && !domain.hasPrefix(".") && !domain.hasSuffix(".")
            && !email.contains(" ")
    }

    private func decodeCredentials(_ body: HTTPBody?) async throws -> Components.Schemas.Credentials {
        let data = try await Data(collecting: body ?? HTTPBody(), upTo: 64 * 1024)
        return try JSONDecoder().decode(Components.Schemas.Credentials.self, from: data)
    }

    private func tokenResponse(_ accessToken: String, status: HTTPResponse.Status = .ok) throws -> (HTTPResponse, HTTPBody?) {
        let payload = Components.Schemas.TokenResponse(
            accessToken: accessToken,
            tokenType: .bearer,
            expiresIn: 28800
        )
        return json(status, encoded(payload))
    }

    private func bearer(from request: HTTPRequest) -> String? {
        guard let header = request.headerFields[.authorization] else { return nil }
        let prefix = "Bearer "
        guard header.hasPrefix(prefix) else { return nil }
        let token = String(header.dropFirst(prefix.count))
        return token.isEmpty ? nil : token
    }

    private func queryItems(from request: HTTPRequest) -> [String: String] {
        guard let path = request.path, let query = path.split(separator: "?", maxSplits: 1).dropFirst().first else {
            return [:]
        }
        var components = URLComponents()
        components.percentEncodedQuery = String(query)
        var items: [String: String] = [:]
        for item in components.queryItems ?? [] {
            items[item.name] = item.value ?? ""
        }
        return items
    }

    private func layerID(from request: HTTPRequest) -> String? {
        guard let path = request.path else { return nil }
        let only = path.split(separator: "?").first.map(String.init) ?? path
        let prefix = "/layers/"
        guard only.hasPrefix(prefix) else { return nil }
        let id = String(only.dropFirst(prefix.count)).removingPercentEncoding ?? ""
        return id.isEmpty ? nil : id
    }

    private func nonempty(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func fold(_ value: String) -> String {
        var folded = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        for (from, to) in [("ae", "ä"), ("oe", "ö"), ("ue", "ü")] {
            folded = folded.replacingOccurrences(of: from, with: to)
        }
        for (from, to) in [("ä", "a"), ("ö", "o"), ("ü", "u"), ("ß", "ss")] {
            folded = folded.replacingOccurrences(of: from, with: to)
        }
        return folded
    }

    private func json(_ status: HTTPResponse.Status, _ payload: String) -> (HTTPResponse, HTTPBody?) {
        json(status, Data(payload.utf8))
    }

    private func json(_ status: HTTPResponse.Status, _ payload: Data) -> (HTTPResponse, HTTPBody?) {
        var response = HTTPResponse(status: status)
        response.headerFields[.contentType] = "application/json"
        return (response, HTTPBody(payload))
    }

    private func failure(status: HTTPResponse.Status, message: String, error: String) -> (HTTPResponse, HTTPBody?) {
        json(status, encoded(ErrorBody(statusCode: status.code, message: message, error: error)))
    }

    private func encoded<T: Encodable>(_ value: T) -> Data {
        (try? JSONEncoder().encode(value)) ?? Data("{}".utf8)
    }
}

private extension NSLock {
    func sync<T>(_ body: () -> T) -> T {
        lock()
        defer { unlock() }
        return body()
    }
}

private struct ErrorBody: Encodable {
    var statusCode: Int
    var message: String
    var error: String
}

extension FixtureTransport {
    static let catalog: [Components.Schemas.SearchHit] = [
        .init(
            id: "addr-10115",
            label: "Invalidenstraße 117, 10115 Berlin",
            grain: .address,
            geoKey: "10115|Berlin|Invalidenstraße|117|",
            lon: 13.3808,
            lat: 52.5305
        ),
        .init(
            id: "addr-80331",
            label: "Marienplatz 1, 80331 München",
            grain: .address,
            geoKey: "80331|München|Marienplatz|1|",
            lon: 11.5755,
            lat: 48.1374
        ),
        .init(
            id: "ags-11000000",
            label: "Berlin",
            grain: .ags,
            geoKey: "11000000",
            lon: 13.405,
            lat: 52.52
        ),
        .init(
            id: "ags-09162000",
            label: "München",
            grain: .ags,
            geoKey: "09162000",
            lon: 11.5755,
            lat: 48.1372
        ),
        .init(
            id: "ags-02000000",
            label: "Hamburg",
            grain: .ags,
            geoKey: "02000000",
            lon: 9.9937,
            lat: 53.5511
        ),
        .init(
            id: "ags-05315000",
            label: "Köln",
            grain: .ags,
            geoKey: "05315000",
            lon: 6.9603,
            lat: 50.9375
        ),
        .init(
            id: "ags-08",
            label: "Baden-Württemberg",
            grain: .ags,
            geoKey: "08"
        ),
        .init(
            id: "plz-10115",
            label: "10115 Berlin",
            grain: .plz5,
            geoKey: "10115",
            lon: 13.387,
            lat: 52.5326
        ),
        .init(
            id: "plz-80331",
            label: "80331 München",
            grain: .plz5,
            geoKey: "80331",
            lon: 11.574,
            lat: 48.134
        ),
    ]

    static let layers: [String: String] = [
        "demo-gemeinden": """
        {"type":"FeatureCollection","name":"Demo-Gemeinden","description":"Synthetic municipal points for the offline fixture. Not an official boundary.","features":[{"type":"Feature","id":"ags:11000000","geometry":{"type":"Point","coordinates":[13.405,52.52]},"properties":{"label":"Berlin","grain":"ags","ags":"11000000","stub":true}},{"type":"Feature","id":"ags:09162000","geometry":{"type":"Point","coordinates":[11.5755,48.1372]},"properties":{"label":"München","grain":"ags","ags":"09162000","stub":true}},{"type":"Feature","id":"ags:02000000","geometry":{"type":"Point","coordinates":[9.9937,53.5511]},"properties":{"label":"Hamburg","grain":"ags","ags":"02000000","stub":true}},{"type":"Feature","id":"ags:05315000","geometry":{"type":"Point","coordinates":[6.9603,50.9375]},"properties":{"label":"Köln","grain":"ags","ags":"05315000","stub":true}}]}
        """,
        "demo-plz": """
        {"type":"FeatureCollection","name":"Demo-PLZ","description":"Synthetic PLZ points for the offline fixture.","features":[{"type":"Feature","id":"plz:10115","geometry":{"type":"Point","coordinates":[13.387,52.5326]},"properties":{"label":"10115 Berlin","grain":"plz5","stub":true}},{"type":"Feature","id":"plz:80331","geometry":{"type":"Point","coordinates":[11.574,48.134]},"properties":{"label":"80331 München","grain":"plz5","stub":true}}]}
        """,
        "demo-grid100": """
        {"type":"FeatureCollection","name":"Demo-Grid100","description":"Schematic rectangle for the documented Zensus 2022 100 m smoke band. Not an official boundary.","features":[{"type":"Feature","id":"grid:smoke","geometry":{"type":"Polygon","coordinates":[[[7.5,47.3],[13.1,47.3],[13.1,47.7],[7.5,47.7],[7.5,47.3]]]},"properties":{"label":"Schematic southern grid smoke extent","grain":"grid100","stub":true}}]}
        """,
    ]
}

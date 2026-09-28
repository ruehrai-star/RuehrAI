import Foundation

/// Path shapes for the first Backend slice.
///
/// The mock client does not open a socket. These helpers exist so the app and
/// the later OpenAPI client agree on the same paths. `example.invalid` is used
/// only as a throwaway host while percent-encoding the search query.
public enum APIRoutes {
    public static let health = "/health"

    public static func search(query: String) -> String {
        var components = URLComponents()
        components.scheme = "https"
        components.host = "example.invalid"
        components.path = "/search"
        components.queryItems = [URLQueryItem(name: "q", value: query)]
        let path = components.percentEncodedPath
        guard let query = components.percentEncodedQuery, !query.isEmpty else {
            return path
        }
        return path + "?" + query
    }

    public static func layer(id: String) -> String {
        "/layers/\(id)"
    }
}

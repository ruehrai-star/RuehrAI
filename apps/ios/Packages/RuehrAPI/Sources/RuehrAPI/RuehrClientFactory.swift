import Foundation
import OpenAPIRuntime

/// Builds the generated OpenAPI `Client`.
///
/// Live calls use a `ClientTransport` such as `URLSessionTransport` from the app.
/// `fixture` never opens a socket. It answers `GET /health`, `POST /auth/login`,
/// `POST /auth/register`, `GET /auth/me`, `GET /search`, and `GET /layers/{id}`
/// with contract-shaped JSON so the UI still runs when the Backend is down.
public enum RuehrClientFactory {
    /// Server URL written in `packages/api-contracts/openapi/openapi.yaml`.
    public static let contractLocalBaseURL = URL(string: "http://localhost:3000")!

    public static func make(
        serverURL: URL,
        transport: any ClientTransport,
        accessToken: @escaping @Sendable () -> String?
    ) -> Client {
        Client(
            serverURL: serverURL,
            transport: transport,
            middlewares: [BearerAuthMiddleware(accessToken: accessToken)]
        )
    }

    public static func fixture(
        accessToken: @escaping @Sendable () -> String? = { nil }
    ) -> Client {
        make(
            serverURL: contractLocalBaseURL,
            transport: FixtureTransport(),
            accessToken: accessToken
        )
    }
}

import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Adds `Authorization: Bearer` from the in-memory token store.
///
/// Login and register stay unauthenticated, matching the OpenAPI `security: []` overrides.
public struct BearerAuthMiddleware: ClientMiddleware {
    public var accessToken: @Sendable () -> String?

    public init(accessToken: @escaping @Sendable () -> String?) {
        self.accessToken = accessToken
    }

    public func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var request = request
        if operationID != "login", operationID != "register",
           let token = accessToken(), !token.isEmpty {
            request.headerFields[.authorization] = "Bearer \(token)"
        }
        return try await next(request, body, baseURL)
    }
}

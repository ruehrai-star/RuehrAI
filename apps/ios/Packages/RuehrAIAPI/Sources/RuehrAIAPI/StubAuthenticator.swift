import Foundation

public struct StubSession: Equatable, Sendable {
    public let email: String
    /// Obvious placeholder. This is not a signed JWT and must not be sent to a real Backend.
    public let accessToken: String
}

public enum AuthError: Error, Equatable, Sendable {
    case emptyEmail
    case invalidEmail
    case emptyPassword
}

extension AuthError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .emptyEmail:
            return "Enter an email address."
        case .invalidEmail:
            return "Enter an email address with a name and a domain."
        case .emptyPassword:
            return "Enter a password."
        }
    }
}

/// In-memory stand-in for the Backend login endpoint.
///
/// A later slice will `POST` the credentials to the Backend JWT or session API
/// and keep the returned token. This type never stores the password, never
/// performs a network call, and never mints a real JWT.
public enum StubAuthenticator {
    public static func signIn(
        email: String,
        password: String,
        makeToken: () -> String = { "stub-session-\(UUID().uuidString)" }
    ) throws -> StubSession {
        let normalized = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if normalized.isEmpty {
            throw AuthError.emptyEmail
        }
        guard isPlausibleEmail(normalized) else {
            throw AuthError.invalidEmail
        }
        if password.isEmpty {
            throw AuthError.emptyPassword
        }
        return StubSession(email: normalized, accessToken: makeToken())
    }

    private static func isPlausibleEmail(_ email: String) -> Bool {
        let parts = email.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2 else { return false }
        let local = parts[0]
        let domain = parts[1]
        guard !local.isEmpty, !domain.isEmpty else { return false }
        guard !local.contains(" "), !domain.contains(" ") else { return false }
        guard domain.contains("."), !domain.hasPrefix("."), !domain.hasSuffix(".") else { return false }
        return true
    }
}

import Foundation
import OpenAPIURLSession
import RuehrAPI
import SwiftUI

/// Session for the generated Backend client. The access token stays in memory.
@MainActor
final class SessionStore: ObservableObject {
    let tokens = TokenStore()
    let client: Client
    let usesFixture: Bool

    @Published private(set) var accessToken: String?
    @Published private(set) var email: String?
    @Published private(set) var userID: String?
    @Published private(set) var expiresIn: Int?
    @Published private(set) var lastError: String?
    @Published private(set) var isWorking = false

    var isSignedIn: Bool {
        accessToken != nil
    }

    init(connection: BackendConnection = .current()) {
        let tokens = TokenStore()
        self.tokens = tokens
        switch connection {
        case .fixture:
            usesFixture = true
            client = RuehrClientFactory.fixture(accessToken: { tokens.get() })
        case .live(let url):
            usesFixture = false
            client = RuehrClientFactory.make(
                serverURL: url,
                transport: URLSessionTransport(),
                accessToken: { tokens.get() }
            )
        }
    }

    func signIn(email: String, password: String) async {
        await authenticate(email: email, password: password, register: false)
    }

    func register(email: String, password: String) async {
        await authenticate(email: email, password: password, register: true)
    }

    func signOut() {
        tokens.set(nil)
        accessToken = nil
        email = nil
        userID = nil
        expiresIn = nil
        lastError = nil
    }

    private func authenticate(email: String, password: String, register: Bool) async {
        isWorking = true
        lastError = nil
        defer { isWorking = false }
        let credentials = Components.Schemas.Credentials(email: email, password: password)
        do {
            let output: AuthOutcome
            if register {
                output = AuthOutcome(try await client.register(body: .json(credentials)))
            } else {
                output = AuthOutcome(try await client.login(body: .json(credentials)))
            }
            switch output {
            case .token(let token):
                tokens.set(token.accessToken)
                accessToken = token.accessToken
                expiresIn = token.expiresIn
                await loadCurrentUser(fallbackEmail: email)
            case .failure(let message):
                clearSession()
                lastError = message
            }
        } catch {
            clearSession()
            lastError = usesFixture
                ? "Fixture sign-in failed."
                : "Could not reach the Backend."
        }
    }

    private func loadCurrentUser(fallbackEmail: String) async {
        do {
            switch try await client.getCurrentUser() {
            case .ok(let ok):
                let user = try ok.body.json
                email = user.email
                userID = user.id
                lastError = nil
            case .unauthorized(let unauthorized):
                email = fallbackEmail.trimmingCharacters(in: .whitespacesAndNewlines)
                lastError = try APIErrorText.message(unauthorized.body.json)
            case .undocumented(let statusCode, _):
                email = fallbackEmail.trimmingCharacters(in: .whitespacesAndNewlines)
                lastError = "Profile request failed (\(statusCode))."
            }
        } catch {
            email = fallbackEmail.trimmingCharacters(in: .whitespacesAndNewlines)
            lastError = nil
        }
    }

    private func clearSession() {
        tokens.set(nil)
        accessToken = nil
        email = nil
        userID = nil
        expiresIn = nil
    }
}

private enum AuthOutcome {
    case token(Components.Schemas.TokenResponse)
    case failure(String)

    init(_ output: Operations.Login.Output) {
        switch output {
        case .ok(let ok):
            if let token = try? ok.body.json {
                self = .token(token)
            } else {
                self = .failure("Sign-in response was not a token.")
            }
        case .badRequest(let badRequest):
            self = .failure((try? APIErrorText.message(badRequest.body.json)) ?? "Check the email and password.")
        case .unauthorized(let unauthorized):
            self = .failure((try? APIErrorText.message(unauthorized.body.json)) ?? "Unknown email or wrong password.")
        case .undocumented(let statusCode, _):
            self = .failure("Sign-in failed (\(statusCode)).")
        }
    }

    init(_ output: Operations.Register.Output) {
        switch output {
        case .created(let created):
            if let token = try? created.body.json {
                self = .token(token)
            } else {
                self = .failure("Registration response was not a token.")
            }
        case .badRequest(let badRequest):
            self = .failure((try? APIErrorText.message(badRequest.body.json)) ?? "Check the email and password.")
        case .conflict(let conflict):
            self = .failure((try? APIErrorText.message(conflict.body.json)) ?? "Email is already registered.")
        case .undocumented(let statusCode, _):
            self = .failure("Registration failed (\(statusCode)).")
        }
    }
}

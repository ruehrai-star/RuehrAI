import Foundation
import RuehrAIAPI
import SwiftUI

/// Holds the stub session in memory. Nothing is written to disk or the Keychain.
@MainActor
final class SessionStore: ObservableObject {
    @Published private(set) var accessToken: String?
    @Published private(set) var email: String?
    @Published private(set) var lastError: String?

    var isSignedIn: Bool {
        accessToken != nil
    }

    func signIn(email: String, password: String) {
        do {
            let session = try StubAuthenticator.signIn(email: email, password: password)
            accessToken = session.accessToken
            self.email = session.email
            lastError = nil
        } catch {
            accessToken = nil
            self.email = nil
            lastError = (error as? LocalizedError)?.errorDescription ?? "Sign-in failed."
        }
    }

    func signOut() {
        accessToken = nil
        email = nil
        lastError = nil
    }
}

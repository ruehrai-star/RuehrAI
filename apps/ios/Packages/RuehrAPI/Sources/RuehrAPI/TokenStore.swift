import Foundation

/// In-memory bearer token. The app does not write this to disk or the Keychain.
public final class TokenStore: @unchecked Sendable {
    private let lock = NSLock()
    private var token: String?

    public init() {}

    public func set(_ token: String?) {
        lock.lock()
        defer { lock.unlock() }
        self.token = token
    }

    public func get() -> String? {
        lock.lock()
        defer { lock.unlock() }
        return token
    }
}

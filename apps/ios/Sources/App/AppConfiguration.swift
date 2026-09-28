import Foundation

enum BackendConnection: Equatable {
    case fixture
    case live(URL)

    /// `RUEHR_API_BASE_URL` from the process environment wins, then Info.plist.
    /// An empty value keeps the offline fixture transport.
    static func current(bundle: Bundle = .main) -> BackendConnection {
        let raw = ProcessInfo.processInfo.environment["RUEHR_API_BASE_URL"]
            ?? bundle.object(forInfoDictionaryKey: "RUEHR_API_BASE_URL") as? String
        let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty, let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            return .fixture
        }
        return .live(url)
    }
}

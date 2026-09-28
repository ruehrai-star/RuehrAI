import Foundation

public enum APIErrorText {
    public static func message(_ error: Components.Schemas.ErrorResponse) -> String {
        switch error.message {
        case .case1(let text) where !text.isEmpty:
            return text
        case .case2(let lines):
            let joined = lines.filter { !$0.isEmpty }.joined(separator: "\n")
            if !joined.isEmpty {
                return joined
            }
        default:
            break
        }
        if let error = error.error, !error.isEmpty {
            return error
        }
        return "Request failed."
    }
}

import XCTest
@testable import RuehrAIAPI

final class StubAuthenticatorTests: XCTestCase {
    func testSignInReturnsInMemoryStubToken() throws {
        let session = try StubAuthenticator.signIn(
            email: "  Analyst@RuehrAI.example ",
            password: "correct horse",
            makeToken: { "stub-session-fixed" }
        )
        XCTAssertEqual(session.email, "analyst@ruehrai.example")
        XCTAssertEqual(session.accessToken, "stub-session-fixed")
        XCTAssertFalse(session.accessToken.contains("correct horse"))
        XCTAssertFalse(session.accessToken.contains("."))
    }

    func testDefaultTokenIsClearlyNotAJWT() throws {
        let session = try StubAuthenticator.signIn(email: "analyst@ruehrai.example", password: "x")
        XCTAssertTrue(session.accessToken.hasPrefix("stub-session-"))
        XCTAssertFalse(session.accessToken.contains("."))
    }

    func testRejectsMalformedCredentials() {
        XCTAssertThrowsError(try StubAuthenticator.signIn(email: "   ", password: "x")) { error in
            XCTAssertEqual(error as? AuthError, .emptyEmail)
        }
        XCTAssertThrowsError(try StubAuthenticator.signIn(email: "not-an-email", password: "x")) { error in
            XCTAssertEqual(error as? AuthError, .invalidEmail)
        }
        XCTAssertThrowsError(try StubAuthenticator.signIn(email: "a@b", password: "x")) { error in
            XCTAssertEqual(error as? AuthError, .invalidEmail)
        }
        XCTAssertThrowsError(try StubAuthenticator.signIn(email: "analyst@ruehrai.example", password: "")) { error in
            XCTAssertEqual(error as? AuthError, .emptyPassword)
        }
    }
}

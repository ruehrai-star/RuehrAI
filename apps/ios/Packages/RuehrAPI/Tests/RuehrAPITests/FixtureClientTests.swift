import HTTPTypes
import OpenAPIRuntime
import XCTest
@testable import RuehrAPI

final class FixtureClientTests: XCTestCase {
    private var tokens = TokenStore()
    private var recorder: PathRecorder!
    private var client: Client!

    override func setUp() {
        super.setUp()
        tokens = TokenStore()
        recorder = PathRecorder()
        client = RuehrClientFactory.make(
            serverURL: RuehrClientFactory.contractLocalBaseURL,
            transport: recorder,
            accessToken: { [tokens] in tokens.get() }
        )
    }

    func testHealthUsesContractPath() async throws {
        let response = try await client.getHealth()
        guard case .ok(let ok) = response else {
            return XCTFail("Expected 200, got \(response)")
        }
        let body = try ok.body.json
        XCTAssertEqual(body.status, .ok)
        XCTAssertEqual(recorder.paths, ["/health"])
    }

    func testLoginSearchAndLayerUseContractPaths() async throws {
        let login = try await client.login(body: .json(.init(
            email: " Analyst@RuehrAI.example ",
            password: "correct horse"
        )))
        guard case .ok(let ok) = login else {
            return XCTFail("Expected 200, got \(login)")
        }
        let token = try ok.body.json
        XCTAssertEqual(token.tokenType, .bearer)
        XCTAssertEqual(token.expiresIn, 28800)
        XCTAssertTrue(token.accessToken.hasPrefix("stub-session-"))
        XCTAssertFalse(token.accessToken.contains("."))
        XCTAssertFalse(token.accessToken.contains("correct horse"))
        tokens.set(token.accessToken)

        let me = try await client.getCurrentUser()
        guard case .ok(let meOK) = me else {
            return XCTFail("Expected 200, got \(me)")
        }
        XCTAssertEqual(try meOK.body.json.email, "analyst@ruehrai.example")

        let search = try await client.searchPlaces(query: .init(q: "10115"))
        guard case .ok(let searchOK) = search else {
            return XCTFail("Expected 200, got \(search)")
        }
        let hits = try searchOK.body.json.hits
        XCTAssertTrue(hits.contains(where: { $0.id == "plz-10115" && $0.grain == .plz5 }))
        XCTAssertTrue(hits.contains(where: { $0.grain == .address }))

        let typed = try await client.searchPlaces(query: .init(q: "Muenchen", _type: .ags))
        guard case .ok(let typedOK) = typed else {
            return XCTFail("Expected 200, got \(typed)")
        }
        let munich = try typedOK.body.json.hits
        XCTAssertEqual(munich.map(\.id), ["ags-09162000"])

        let missingPoint = try await client.searchPlaces(query: .init(q: "Baden"))
        guard case .ok(let missingOK) = missingPoint else {
            return XCTFail("Expected 200, got \(missingPoint)")
        }
        let baden = try XCTUnwrap(try missingOK.body.json.hits.first)
        XCTAssertEqual(baden.geoKey, "08")
        XCTAssertNil(baden.lat)
        XCTAssertNil(baden.lon)

        let layer = try await client.getLayer(path: .init(id: "demo-grid100"))
        guard case .ok(let layerOK) = layer else {
            return XCTFail("Expected 200, got \(layer)")
        }
        let collection = try layerOK.body.json
        XCTAssertEqual(collection._type, .featureCollection)
        XCTAssertEqual(collection.name, "Demo-Grid100")
        let data = try JSONEncoder().encode(collection)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["type"] as? String, "FeatureCollection")
        let features = try XCTUnwrap(object["features"] as? [[String: Any]])
        let geometry = try XCTUnwrap(features.first?["geometry"] as? [String: Any])
        XCTAssertEqual(geometry["type"] as? String, "Polygon")

        XCTAssertEqual(
            recorder.paths,
            [
                "/auth/login",
                "/auth/me",
                "/search?q=10115",
                "/search?q=Muenchen&type=ags",
                "/search?q=Baden",
                "/layers/demo-grid100",
            ]
        )
    }

    func testSearchRequiresBearerAndUnknownLayerIs404() async throws {
        let search = try await client.searchPlaces(query: .init(q: "Berlin"))
        guard case .unauthorized = search else {
            return XCTFail("Expected 401, got \(search)")
        }

        _ = try await signIn()
        let missing = try await client.getLayer(path: .init(id: "missing"))
        guard case .notFound = missing else {
            return XCTFail("Expected 404, got \(missing)")
        }
    }

    func testRegisterConflictAndShortPassword() async throws {
        let created = try await client.register(body: .json(.init(
            email: "new@ruehrai.example",
            password: "long-enough"
        )))
        guard case .created(let createdOK) = created else {
            return XCTFail("Expected 201, got \(created)")
        }
        let token = try createdOK.body.json.accessToken
        XCTAssertTrue(token.hasPrefix("stub-session-"))

        let again = try await client.register(body: .json(.init(
            email: "new@ruehrai.example",
            password: "long-enough"
        )))
        guard case .conflict = again else {
            return XCTFail("Expected 409, got \(again)")
        }

        let short = try await client.login(body: .json(.init(
            email: "analyst@ruehrai.example",
            password: "short"
        )))
        guard case .badRequest = short else {
            return XCTFail("Expected 400, got \(short)")
        }
        XCTAssertTrue(recorder.paths.contains("/auth/register"))
        XCTAssertTrue(recorder.paths.contains("/auth/login"))
    }

    private func signIn() async throws {
        let login = try await client.login(body: .json(.init(
            email: "analyst@ruehrai.example",
            password: "correct horse"
        )))
        guard case .ok(let ok) = login else {
            XCTFail("Expected login")
            return
        }
        tokens.set(try ok.body.json.accessToken)
    }
}

private final class PathRecorder: ClientTransport, @unchecked Sendable {
    private let inner = FixtureTransport()
    private let lock = NSLock()
    private var stored: [String] = []

    var paths: [String] {
        lock.sync { stored }
    }

    func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        record(request.path ?? "")
        return try await inner.send(request, body: body, baseURL: baseURL, operationID: operationID)
    }

    private func record(_ path: String) {
        lock.sync { stored.append(path) }
    }
}

private extension NSLock {
    func sync<T>(_ body: () -> T) -> T {
        lock()
        defer { unlock() }
        return body()
    }
}

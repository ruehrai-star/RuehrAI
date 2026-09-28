import XCTest
@testable import RuehrAIAPI

final class MockAPIClientTests: XCTestCase {
    private let client = MockAPIClient()

    func testHealthEncodesStatusOk() async throws {
        let response = try await client.health()
        XCTAssertEqual(response.status, "ok")

        let data = try JSONEncoder().encode(response)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: String]
        XCTAssertEqual(object, ["status": "ok"])
        XCTAssertEqual(APIRoutes.health, "/health")
    }

    func testSearchMatchesAddressAGSAndPLZ() async throws {
        let berlin = try await client.search(query: "10115")
        XCTAssertTrue(berlin.contains(where: { $0.id == "plz-10115" }))
        XCTAssertTrue(berlin.contains(where: { $0.kind == .address }))

        let munich = try await client.search(query: "munchen")
        XCTAssertTrue(munich.contains(where: { $0.id == "ags-09162000" }))
        let typedMunich = try await client.search(query: "Muenchen")
        XCTAssertTrue(typedMunich.contains(where: { $0.id == "ags-09162000" }))

        let cologne = try await client.search(query: "Koeln")
        XCTAssertEqual(cologne.map(\.id), ["ags-05315000", "plz-50667"])

        let postalCodes = try await client.search(query: "plz")
        XCTAssertFalse(postalCodes.isEmpty)
        XCTAssertTrue(postalCodes.allSatisfy { $0.kind == .plz })
    }

    func testSearchOmitsCoordinatesWhenUnknown() async throws {
        let results = try await client.search(query: "baden")
        XCTAssertEqual(results.map(\.id), ["ags-08"])
        XCTAssertNil(results[0].coordinate)

        let data = try JSONEncoder().encode(results)
        let array = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
        XCTAssertEqual(array.count, 1)
        XCTAssertNil(array[0]["lat"])
        XCTAssertNil(array[0]["lon"])
        XCTAssertEqual(array[0]["kind"] as? String, "ags")
        XCTAssertEqual(array[0]["id"] as? String, "ags-08")
    }

    func testSearchRejectsBlankQueryAndUnknownText() async {
        do {
            _ = try await client.search(query: "   ")
            XCTFail("Expected emptyQuery")
        } catch let error as APIError {
            XCTAssertEqual(error, .emptyQuery)
        } catch {
            XCTFail("Unexpected error \(error)")
        }

        let misses = try? await client.search(query: "zzzz-not-a-place")
        XCTAssertEqual(misses, [])
    }

    func testSearchRouteRoundTripsQuery() throws {
        let route = APIRoutes.search(query: "München")
        XCTAssertTrue(route.hasPrefix("/search?"))
        let components = URLComponents(string: "https://example.invalid" + route)
        XCTAssertEqual(components?.queryItems?.first?.name, "q")
        XCTAssertEqual(components?.queryItems?.first?.value, "München")
        XCTAssertEqual(APIRoutes.layer(id: MockAPIClient.sampleLayerID), "/layers/de-sample")
    }

    func testSampleLayerIsWGS84FeatureCollection() async throws {
        let collection = try await client.layer(id: MockAPIClient.sampleLayerID)
        XCTAssertEqual(collection.type, "FeatureCollection")

        let data = try collection.jsonData()
        let decoded = try JSONDecoder().decode(GeoJSONFeatureCollection.self, from: data)
        XCTAssertEqual(decoded, collection)

        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["type"] as? String, "FeatureCollection")

        let polygon = try XCTUnwrap(collection.features.first { feature in
            if case .polygon = feature.geometry { return true }
            return false
        })
        guard case .polygon(let rings) = polygon.geometry else {
            return XCTFail("Expected a polygon")
        }
        let ring = try XCTUnwrap(rings.first)
        XCTAssertGreaterThanOrEqual(ring.count, 4)
        XCTAssertEqual(ring.first, ring.last)
        XCTAssertTrue(ring.allSatisfy { position in
            (7.5...13.1).contains(position.longitude) && (47.3...47.7).contains(position.latitude)
        })

        let points = collection.features.compactMap { feature -> GeoJSONPosition? in
            if case .point(let position) = feature.geometry { return position }
            return nil
        }
        XCTAssertGreaterThanOrEqual(points.count, 4)
        XCTAssertTrue(points.allSatisfy { position in
            (6.0...15.0).contains(position.longitude) && (47.0...55.0).contains(position.latitude)
        })
    }

    func testUnknownLayerFails() async {
        do {
            _ = try await client.layer(id: "missing")
            XCTFail("Expected unknownLayer")
        } catch let error as APIError {
            XCTAssertEqual(error, .unknownLayer("missing"))
        } catch {
            XCTFail("Unexpected error \(error)")
        }
    }

    func testCatalogIdentifiersAreUnique() {
        let ids = MockAPIClient.catalog.map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count)
        XCTAssertTrue(MockAPIClient.catalog.allSatisfy { SearchHitKind.allCases.contains($0.kind) })
    }
}

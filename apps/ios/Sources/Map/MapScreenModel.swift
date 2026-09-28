import Foundation
import RuehrAPI
import SwiftUI

@MainActor
final class MapScreenModel: ObservableObject {
    @Published var query = ""
    @Published var layerID = FixtureTransport.seededLayerIDs[0]
    @Published private(set) var results: [Components.Schemas.SearchHit] = []
    @Published private(set) var isSearching = false
    @Published private(set) var searchError: String?
    @Published private(set) var resultsCollapsed = false
    @Published private(set) var healthSummary = "Checking backend…"
    @Published private(set) var healthOK = false
    @Published private(set) var layerSummary = "Loading layer…"
    @Published private(set) var banner: String?
    @Published var geoJSON: Data?
    @Published var overlayError: String?
    @Published private(set) var focus: MapFocus = .germany

    private let client: Client
    private var searchGeneration = 0

    init(client: Client) {
        self.client = client
    }

    func refreshHealth() async {
        do {
            switch try await client.getHealth() {
            case .ok(let ok):
                let status = try ok.body.json.status
                healthOK = status == .ok
                healthSummary = healthOK ? "API ok" : "Backend status \(status.rawValue)"
            case .undocumented(let statusCode, _):
                healthOK = false
                healthSummary = "Health check failed (\(statusCode))"
            }
        } catch {
            healthOK = false
            healthSummary = "Backend unavailable"
        }
    }

    func refreshLayer() async {
        do {
            switch try await client.getLayer(path: .init(id: layerID)) {
            case .ok(let ok):
                let collection = try ok.body.json
                geoJSON = try JSONEncoder().encode(collection)
                layerSummary = collection.name ?? "Layer \(layerID)"
            case .notFound(let notFound):
                geoJSON = nil
                layerSummary = try APIErrorText.message(notFound.body.json)
            case .badRequest(let badRequest):
                geoJSON = nil
                layerSummary = try APIErrorText.message(badRequest.body.json)
            case .unauthorized:
                geoJSON = nil
                layerSummary = "Sign in again to load the layer."
            case .undocumented(let statusCode, _):
                geoJSON = nil
                layerSummary = "Layer request failed (\(statusCode))"
            }
        } catch {
            geoJSON = nil
            layerSummary = "Layer \(layerID) failed"
        }
    }

    func performSearch() async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        searchGeneration += 1
        let generation = searchGeneration

        guard !trimmed.isEmpty else {
            results = []
            searchError = nil
            isSearching = false
            resultsCollapsed = false
            return
        }

        isSearching = true
        resultsCollapsed = false

        do {
            try await Task.sleep(nanoseconds: 250_000_000)
            guard generation == searchGeneration, !Task.isCancelled else { return }
            let output = try await client.searchPlaces(query: .init(q: trimmed))
            guard generation == searchGeneration, !Task.isCancelled else { return }
            switch output {
            case .ok(let ok):
                results = try ok.body.json.hits
                searchError = nil
            case .badRequest(let badRequest):
                results = []
                searchError = try APIErrorText.message(badRequest.body.json)
            case .unauthorized:
                results = []
                searchError = "Sign in again to search."
            case .undocumented(let statusCode, _):
                results = []
                searchError = "Search failed (\(statusCode))."
            }
            isSearching = false
        } catch is CancellationError {
            return
        } catch {
            guard generation == searchGeneration else { return }
            results = []
            searchError = "Search failed."
            isSearching = false
        }
    }

    func select(_ hit: Components.Schemas.SearchHit) {
        resultsCollapsed = true
        guard let lat = hit.lat, let lon = hit.lon else {
            banner = "\(hit.label) has no coordinates."
            return
        }
        focus = focus.moving(toLatitude: lat, longitude: lon, zoom: hit.grain.focusZoom)
        banner = hit.label
    }
}

extension Components.Schemas.SearchHit: Identifiable {}

extension Components.Schemas.Grain {
    var focusZoom: Double {
        switch self {
        case .address:
            return 15
        case .plz5, .plz8:
            return 13
        case .ags, .ags5:
            return 10
        case .grid100:
            return 14
        case .other:
            return 8
        }
    }

    var displayName: String {
        switch self {
        case .address:
            return "Address"
        case .plz5:
            return "PLZ5"
        case .plz8:
            return "PLZ8"
        case .ags:
            return "AGS"
        case .ags5:
            return "AGS5"
        case .grid100:
            return "Grid"
        case .other:
            return "Other"
        }
    }
}

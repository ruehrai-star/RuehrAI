import Foundation
import RuehrAIAPI
import SwiftUI

@MainActor
final class MapScreenModel: ObservableObject {
    @Published var query = ""
    @Published private(set) var results: [SearchHit] = []
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

    private let api: any RuehrAPIClient
    private var searchGeneration = 0

    init(api: any RuehrAPIClient) {
        self.api = api
    }

    func load() async {
        await refreshHealth()
        await refreshLayer()
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
            let hits = try await api.search(query: trimmed)
            guard generation == searchGeneration, !Task.isCancelled else { return }
            results = hits
            searchError = nil
            isSearching = false
        } catch is CancellationError {
            return
        } catch {
            guard generation == searchGeneration else { return }
            results = []
            searchError = (error as? LocalizedError)?.errorDescription ?? "Search failed."
            isSearching = false
        }
    }

    func select(_ hit: SearchHit) {
        resultsCollapsed = true
        guard let coordinate = hit.coordinate else {
            banner = "\(hit.label) has no coordinates."
            return
        }
        focus = focus.moving(
            toLatitude: coordinate.latitude,
            longitude: coordinate.longitude,
            zoom: hit.kind.focusZoom
        )
        banner = hit.label
    }

    private func refreshHealth() async {
        do {
            let response = try await api.health()
            healthOK = response.status == "ok"
            healthSummary = healthOK ? "Backend mock ok" : "Backend status \(response.status)"
        } catch {
            healthOK = false
            healthSummary = "Backend unavailable"
        }
    }

    private func refreshLayer() async {
        do {
            let collection = try await api.layer(id: MockAPIClient.sampleLayerID)
            geoJSON = try collection.jsonData()
            layerSummary = "Layer \(MockAPIClient.sampleLayerID)"
        } catch {
            geoJSON = nil
            layerSummary = "Layer \(MockAPIClient.sampleLayerID) failed"
        }
    }
}

extension SearchHitKind {
    var focusZoom: Double {
        switch self {
        case .address:
            return 15
        case .plz:
            return 13
        case .ags:
            return 10
        }
    }

    var displayName: String {
        switch self {
        case .address:
            return "Address"
        case .ags:
            return "AGS"
        case .plz:
            return "PLZ"
        }
    }
}

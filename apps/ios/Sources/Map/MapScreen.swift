import RuehrAIAPI
import SwiftUI

struct MapScreen: View {
    @EnvironmentObject private var session: SessionStore
    @StateObject private var model: MapScreenModel
    @FocusState private var searchFocused: Bool

    init(api: any RuehrAPIClient = MockAPIClient()) {
        _model = StateObject(wrappedValue: MapScreenModel(api: api))
    }

    var body: some View {
        ZStack(alignment: .top) {
            MapLibreMapView(
                geoJSON: model.geoJSON,
                focus: model.focus,
                overlayError: $model.overlayError
            )
            .accessibilityLabel("Map of Germany")

            VStack(spacing: 8) {
                searchCard
                if showsResults {
                    resultsCard
                } else if let banner = model.banner {
                    Text(banner)
                        .font(.footnote)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(.thinMaterial, in: Capsule())
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            statusBar
        }
        .task {
            await model.load()
        }
        .task(id: model.query) {
            await model.performSearch()
        }
    }

    private var showsResults: Bool {
        !model.resultsCollapsed
            && !model.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var searchCard: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            TextField("Address, AGS, or PLZ", text: $model.query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .focused($searchFocused)
                .accessibilityLabel("Search address, AGS, or PLZ")
            if !model.query.isEmpty {
                Button {
                    model.query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .accessibilityLabel("Clear search")
            }
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var resultsCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            if model.isSearching {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Searching")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(12)
            }
            if let searchError = model.searchError {
                Text(searchError)
                    .font(.subheadline)
                    .foregroundStyle(.red)
                    .padding(12)
            }
            if model.results.isEmpty && !model.isSearching && model.searchError == nil {
                Text("No matches")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(12)
            } else if !model.results.isEmpty {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(model.results) { hit in
                            Button {
                                searchFocused = false
                                model.select(hit)
                            } label: {
                                resultRow(hit)
                            }
                            .buttonStyle(.plain)
                            .accessibilityHint(hit.coordinate == nil ? "No coordinates" : "Centers the map")
                            Divider()
                        }
                    }
                }
                .frame(maxHeight: 280)
            }
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func resultRow(_ hit: SearchHit) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(hit.label)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                if hit.coordinate == nil {
                    Text("No coordinates")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 8)
            Text(hit.kind.displayName)
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(AppTheme.accent.opacity(0.12), in: Capsule())
                .foregroundStyle(AppTheme.accent)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }

    private var statusBar: some View {
        HStack(alignment: .center, spacing: 10) {
            Circle()
                .fill(model.healthOK ? Color.green : Color.orange)
                .frame(width: 8, height: 8)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(model.healthSummary)
                Text(statusDetail)
                    .foregroundStyle(.secondary)
            }
            .font(.caption)
            Spacer(minLength: 8)
            Button("Sign out", role: .destructive) {
                session.signOut()
            }
            .font(.caption.weight(.semibold))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial)
        .accessibilityElement(children: .contain)
    }

    private var statusDetail: String {
        if let overlayError = model.overlayError {
            return overlayError
        }
        if let email = session.email {
            return "\(model.layerSummary) · \(email)"
        }
        return model.layerSummary
    }
}

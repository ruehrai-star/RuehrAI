import CoreLocation
import MapLibre
import SwiftUI
import UIKit

enum MapStyle {
    /// Keyless community basemap (OpenStreetMap data, OpenFreeMap style).
    /// The MapLibre logo and attribution button stay visible.
    static let openFreeMapLiberty = URL(string: "https://tiles.openfreemap.org/styles/liberty")!
}

/// SwiftUI bridge over MapLibre Native.
///
/// Sources can be added only after the style loads. The delegate applies the
/// latest GeoJSON when that happens, and `updateUIView` applies it if the mock
/// layer arrives later. Circle, line, and fill layers draw points, lines, and
/// polygons. This file is compiled on a Mac; the Linux agent does not link MapLibre.
struct MapLibreMapView: UIViewRepresentable {
    var geoJSON: Data?
    var focus: MapFocus
    @Binding var overlayError: String?

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> MLNMapView {
        let mapView = MLNMapView(frame: .zero, styleURL: MapStyle.openFreeMapLiberty)
        mapView.delegate = context.coordinator
        mapView.tintColor = AppTheme.accentUIColor
        bind(context.coordinator)
        context.coordinator.focusToken = focus.token
        mapView.setCenter(
            CLLocationCoordinate2D(latitude: focus.latitude, longitude: focus.longitude),
            zoomLevel: focus.zoom,
            animated: false
        )
        return mapView
    }

    func updateUIView(_ mapView: MLNMapView, context: Context) {
        bind(context.coordinator)
        context.coordinator.geoJSON = geoJSON
        if let style = mapView.style {
            context.coordinator.apply(to: style)
        }
        guard context.coordinator.focusToken != focus.token else { return }
        context.coordinator.focusToken = focus.token
        mapView.setCenter(
            CLLocationCoordinate2D(latitude: focus.latitude, longitude: focus.longitude),
            zoomLevel: focus.zoom,
            animated: true
        )
    }

    private func bind(_ coordinator: Coordinator) {
        coordinator.reportOverlayError = { message in
            DispatchQueue.main.async {
                if self.overlayError != message {
                    self.overlayError = message
                }
            }
        }
    }

    final class Coordinator: NSObject, MLNMapViewDelegate {
        var geoJSON: Data?
        var focusToken: UUID?
        var reportOverlayError: ((String?) -> Void)?

        private var appliedData: Data?
        private var overlayError: String?

        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            appliedData = nil
            apply(to: style)
        }

        func apply(to style: MLNStyle) {
            guard let geoJSON else { return }
            guard geoJSON != appliedData else { return }
            do {
                let shape = try MLNShape(data: geoJSON, encoding: String.Encoding.utf8.rawValue)
                let source: MLNShapeSource
                if let existing = style.source(withIdentifier: LayerID.source) as? MLNShapeSource {
                    existing.shape = shape
                    source = existing
                } else {
                    source = MLNShapeSource(identifier: LayerID.source, shape: shape, options: nil)
                    style.addSource(source)
                }
                addLayersIfNeeded(source: source, style: style)
                appliedData = geoJSON
                setOverlayError(nil)
            } catch {
                setOverlayError("Could not read the layer GeoJSON.")
            }
        }

        private func addLayersIfNeeded(source: MLNShapeSource, style: MLNStyle) {
            if style.layer(withIdentifier: LayerID.fill) == nil {
                let fill = MLNFillStyleLayer(identifier: LayerID.fill, source: source)
                fill.fillColor = NSExpression(forConstantValue: AppTheme.fillUIColor)
                fill.fillOutlineColor = NSExpression(forConstantValue: AppTheme.accentUIColor)
                style.addLayer(fill)
            }
            if style.layer(withIdentifier: LayerID.line) == nil {
                let line = MLNLineStyleLayer(identifier: LayerID.line, source: source)
                line.lineColor = NSExpression(forConstantValue: AppTheme.accentUIColor)
                line.lineWidth = NSExpression(forConstantValue: NSNumber(value: 2))
                style.addLayer(line)
            }
            if style.layer(withIdentifier: LayerID.circle) == nil {
                let circle = MLNCircleStyleLayer(identifier: LayerID.circle, source: source)
                circle.circleRadius = NSExpression(forConstantValue: NSNumber(value: 7))
                circle.circleColor = NSExpression(forConstantValue: AppTheme.accentUIColor)
                circle.circleStrokeWidth = NSExpression(forConstantValue: NSNumber(value: 2))
                circle.circleStrokeColor = NSExpression(forConstantValue: UIColor.white)
                style.addLayer(circle)
            }
        }

        private func setOverlayError(_ message: String?) {
            guard overlayError != message else { return }
            overlayError = message
            reportOverlayError?(message)
        }
    }
}

private enum LayerID {
    static let source = "ruehr-geojson"
    static let fill = "ruehr-fill"
    static let line = "ruehr-line"
    static let circle = "ruehr-circle"
}

import Foundation

struct MapFocus: Equatable {
    var latitude: Double
    var longitude: Double
    var zoom: Double
    /// Changes when the camera should animate to `latitude` / `longitude`.
    var token: UUID

    static let germany = MapFocus(
        latitude: 51.1634,
        longitude: 10.4477,
        zoom: 5.3,
        token: UUID()
    )

    func moving(toLatitude latitude: Double, longitude: Double, zoom: Double) -> MapFocus {
        MapFocus(latitude: latitude, longitude: longitude, zoom: zoom, token: UUID())
    }
}

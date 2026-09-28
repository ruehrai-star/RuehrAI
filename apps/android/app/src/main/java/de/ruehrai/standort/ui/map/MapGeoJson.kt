package de.ruehrai.standort.ui.map

import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.FillLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.sources.GeoJsonSource

internal const val DEMO_STYLE_URI = "https://demotiles.maplibre.org/style.json"
internal const val AREAS_SOURCE_ID = "standort-areas"
internal const val SELECTION_SOURCE_ID = "standort-selection"

internal fun Style.upsertAreas(geoJson: String) {
    val existing = getSourceAs<GeoJsonSource>(AREAS_SOURCE_ID)
    if (existing == null) {
        addSource(GeoJsonSource(AREAS_SOURCE_ID, geoJson))
        addLayer(
            FillLayer("standort-areas-fill", AREAS_SOURCE_ID).withProperties(
                PropertyFactory.fillColor("#1F4E5F"),
                PropertyFactory.fillOpacity(0.35f),
            ),
        )
        addLayer(
            LineLayer("standort-areas-line", AREAS_SOURCE_ID).withProperties(
                PropertyFactory.lineColor("#163844"),
                PropertyFactory.lineWidth(1.5f),
            ),
        )
        addLayer(
            CircleLayer("standort-areas-circle", AREAS_SOURCE_ID).withProperties(
                PropertyFactory.circleRadius(6f),
                PropertyFactory.circleColor("#1F4E5F"),
                PropertyFactory.circleStrokeWidth(1.5f),
                PropertyFactory.circleStrokeColor("#F4F1EC"),
            ),
        )
    } else {
        existing.setGeoJson(geoJson)
    }
}

internal fun Style.upsertSelection(geoJson: String) {
    val existing = getSourceAs<GeoJsonSource>(SELECTION_SOURCE_ID)
    if (existing == null) {
        addSource(GeoJsonSource(SELECTION_SOURCE_ID, geoJson))
        addLayer(
            CircleLayer("standort-selection-circle", SELECTION_SOURCE_ID).withProperties(
                PropertyFactory.circleRadius(8f),
                PropertyFactory.circleColor("#C4622D"),
                PropertyFactory.circleStrokeWidth(2f),
                PropertyFactory.circleStrokeColor("#FFF8F4"),
            ),
        )
    } else {
        existing.setGeoJson(geoJson)
    }
}

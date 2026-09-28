package de.ruehrai.standort.data.sample

import de.ruehrai.standort.data.model.SearchHit
import de.ruehrai.standort.data.model.SearchKind

internal data class SampleLayer(
    val id: String,
    val name: String,
    val geoJson: String,
)

/**
 * Local stand-in for `GET /search` and `GET /layers/{id}`.
 * Geometries are schematic boxes for the shell, not official boundaries.
 */
internal object SampleCatalog {
    val hits: List<SearchHit> = listOf(
        hit(
            id = "addr-essen-kettwiger",
            kind = SearchKind.ADDRESS,
            label = "Kettwiger Straße 2, 45127 Essen",
            subtitle = "Adresse · Essen",
            latitude = 51.4556,
            longitude = 7.0116,
            ags = "05113000",
            plz = "45127",
        ),
        hit(
            id = "addr-dortmund-friedensplatz",
            kind = SearchKind.ADDRESS,
            label = "Friedensplatz 1, 44135 Dortmund",
            subtitle = "Adresse · Dortmund",
            latitude = 51.5136,
            longitude = 7.4653,
            ags = "05913000",
            plz = "44135",
        ),
        hit(
            id = "addr-duisburg-koenig",
            kind = SearchKind.ADDRESS,
            label = "Königstraße 1, 47051 Duisburg",
            subtitle = "Adresse · Duisburg",
            latitude = 51.4344,
            longitude = 6.7623,
            ags = "05112000",
            plz = "47051",
        ),
        hit(
            id = "addr-bochum-rathaus",
            kind = SearchKind.ADDRESS,
            label = "Willy-Brandt-Platz 1, 44787 Bochum",
            subtitle = "Adresse · Bochum",
            latitude = 51.4818,
            longitude = 7.2162,
            ags = "05911000",
            plz = "44787",
        ),
        hit(
            id = "ags-essen",
            kind = SearchKind.AGS,
            label = "05113000",
            subtitle = "AGS · Essen",
            latitude = 51.4556,
            longitude = 7.0116,
            ags = "05113000",
            plz = "45127",
        ),
        hit(
            id = "ags-dortmund",
            kind = SearchKind.AGS,
            label = "05913000",
            subtitle = "AGS · Dortmund",
            latitude = 51.5136,
            longitude = 7.4653,
            ags = "05913000",
            plz = "44135",
        ),
        hit(
            id = "ags-duisburg",
            kind = SearchKind.AGS,
            label = "05112000",
            subtitle = "AGS · Duisburg",
            latitude = 51.4344,
            longitude = 6.7623,
            ags = "05112000",
            plz = "47051",
        ),
        hit(
            id = "plz-45127",
            kind = SearchKind.PLZ,
            label = "45127",
            subtitle = "PLZ · Essen",
            latitude = 51.4556,
            longitude = 7.0116,
            ags = "05113000",
            plz = "45127",
        ),
        hit(
            id = "plz-44135",
            kind = SearchKind.PLZ,
            label = "44135",
            subtitle = "PLZ · Dortmund",
            latitude = 51.5136,
            longitude = 7.4653,
            ags = "05913000",
            plz = "44135",
        ),
        hit(
            id = "plz-45879",
            kind = SearchKind.PLZ,
            label = "45879",
            subtitle = "PLZ · Gelsenkirchen",
            latitude = 51.5110,
            longitude = 7.0960,
            ags = "05513000",
            plz = "45879",
        ),
    )

    val layers: Map<String, SampleLayer> = mapOf(
        "ruhr-gemeinden" to SampleLayer(
            id = "ruhr-gemeinden",
            name = "Beispielgebiete Ruhr",
            geoJson = RUHR_GEMEINDEN_GEOJSON,
        ),
    )

    private fun hit(
        id: String,
        kind: SearchKind,
        label: String,
        subtitle: String,
        latitude: Double,
        longitude: Double,
        ags: String,
        plz: String,
    ) = SearchHit(
        id = id,
        kind = kind,
        label = label,
        subtitle = subtitle,
        latitude = latitude,
        longitude = longitude,
        ags = ags,
        plz = plz,
    )
}

private val RUHR_GEMEINDEN_GEOJSON = """
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "essen",
      "properties": { "name": "Essen", "ags": "05113000" },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[
          [6.92, 51.40],
          [7.12, 51.40],
          [7.12, 51.52],
          [6.92, 51.52],
          [6.92, 51.40]
        ]]
      }
    },
    {
      "type": "Feature",
      "id": "dortmund",
      "properties": { "name": "Dortmund", "ags": "05913000" },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[
          [7.32, 51.46],
          [7.58, 51.46],
          [7.58, 51.58],
          [7.32, 51.58],
          [7.32, 51.46]
        ]]
      }
    },
    {
      "type": "Feature",
      "id": "duisburg",
      "properties": { "name": "Duisburg", "ags": "05112000" },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[
          [6.68, 51.38],
          [6.86, 51.38],
          [6.86, 51.52],
          [6.68, 51.52],
          [6.68, 51.38]
        ]]
      }
    }
  ]
}
""".trimIndent()

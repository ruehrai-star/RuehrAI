package de.ruehrai.standort.data.sample

import de.ruehrai.api.models.Feature
import de.ruehrai.api.models.FeatureCollection
import de.ruehrai.api.models.Geometry
import de.ruehrai.api.models.Grain
import de.ruehrai.api.models.SearchHit
import de.ruehrai.standort.data.model.DemoLayers

/**
 * Same rows as the Backend dev seed (`app.search_places`, `app.map_layers`).
 * Geometries are synthetic stubs, not official boundaries.
 */
internal object SampleCatalog {
    val hits: List<SearchHit> = listOf(
        hit("ags:09162000", "München", Grain.AGS, "09162000", 11.5755, 48.1374),
        hit("ags:11000000", "Berlin", Grain.AGS, "11000000", 13.4050, 52.5200),
        hit("ags:02000000", "Hamburg", Grain.AGS, "02000000", 9.9937, 53.5511),
        hit("plz5:80331", "80331 München", Grain.PLZ5, "80331", 11.5760, 48.1370),
        hit("plz5:10115", "10115 Berlin", Grain.PLZ5, "10115", 13.3870, 52.5320),
        hit(
            "address:demo-marienplatz-1",
            "Marienplatz 1, München",
            Grain.ADDRESS,
            "address:demo-marienplatz-1",
            11.5754,
            48.1372,
        ),
        hit("grid100:demo-muenchen", "Demo-Zelle München", Grain.GRID100, "grid100:demo-muenchen", 11.5755, 48.1374),
    )

    val layers: Map<String, FeatureCollection> = mapOf(
        DemoLayers.GEMEINDEN to collection(
            name = "Demo-Gemeinden",
            description = "Synthetische Punkte und ein Kasten für den Dev-Slice. Keine amtlichen Grenzen.",
            features = listOf(
                polygon(
                    id = "ags:09162000",
                    label = "München",
                    ring = listOf(
                        listOf(11.36, 48.06),
                        listOf(11.72, 48.06),
                        listOf(11.72, 48.25),
                        listOf(11.36, 48.25),
                        listOf(11.36, 48.06),
                    ),
                    properties = mapOf("label" to "München", "grain" to "ags", "ags" to "09162000", "stub" to true),
                ),
                point("ags:11000000", 13.405, 52.52, mapOf("label" to "Berlin", "grain" to "ags", "ags" to "11000000", "stub" to true)),
                point("ags:02000000", 9.9937, 53.5511, mapOf("label" to "Hamburg", "grain" to "ags", "ags" to "02000000", "stub" to true)),
            ),
        ),
        DemoLayers.PLZ to collection(
            name = "Demo-PLZ",
            description = "Synthetische PLZ-Punkte für den Dev-Slice.",
            features = listOf(
                point("plz5:80331", 11.576, 48.137, mapOf("label" to "80331 München", "grain" to "plz5", "plz" to "80331", "stub" to true)),
                point("plz5:10115", 13.387, 52.532, mapOf("label" to "10115 Berlin", "grain" to "plz5", "plz" to "10115", "stub" to true)),
            ),
        ),
        DemoLayers.GRID100 to collection(
            name = "Demo-Gitter 100 m",
            description = "Eine synthetische 100-m-Zelle. Keine Zensus-Geometrie.",
            features = listOf(
                point(
                    "grid100:demo-muenchen",
                    11.5755,
                    48.1374,
                    mapOf("label" to "Demo-Zelle München", "grain" to "grid100", "stub" to true),
                ),
            ),
        ),
    )

    private fun hit(
        id: String,
        label: String,
        grain: Grain,
        geoKey: String,
        lon: Double,
        lat: Double,
    ) = SearchHit(id = id, label = label, grain = grain, geoKey = geoKey, lon = lon, lat = lat)

    private fun collection(
        name: String,
        description: String,
        features: List<Feature>,
    ) = FeatureCollection(
        type = FeatureCollection.Type.FEATURE_COLLECTION,
        features = features,
        name = name,
        description = description,
    )

    private fun point(
        id: String,
        lon: Double,
        lat: Double,
        properties: Map<String, Any>,
    ) = Feature(
        type = Feature.Type.FEATURE,
        geometry = Geometry(type = Geometry.Type.POINT, coordinates = listOf(lon, lat)),
        properties = properties,
        id = id,
    )

    private fun polygon(
        id: String,
        label: String,
        ring: List<List<Double>>,
        properties: Map<String, Any>,
    ): Feature {
        check(label.isNotEmpty())
        return Feature(
            type = Feature.Type.FEATURE,
            geometry = Geometry(type = Geometry.Type.POLYGON, coordinates = listOf(ring)),
            properties = properties,
            id = id,
        )
    }
}

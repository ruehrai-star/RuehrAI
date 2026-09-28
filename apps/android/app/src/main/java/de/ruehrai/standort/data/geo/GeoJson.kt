package de.ruehrai.standort.data.geo

import de.ruehrai.api.models.FeatureCollection
import de.ruehrai.api.models.Geometry
import de.ruehrai.api.models.SearchHit
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

fun FeatureCollection.toGeoJson(): String =
    buildJsonObject {
        put("type", "FeatureCollection")
        name?.let { put("name", it) }
        description?.let { put("description", it) }
        put(
            "features",
            buildJsonArray {
                features.forEach { feature ->
                    add(
                        buildJsonObject {
                            put("type", "Feature")
                            feature.id?.let { put("id", it) }
                            put(
                                "geometry",
                                buildJsonObject {
                                    put("type", feature.geometry.type.value)
                                    put("coordinates", jsonValue(feature.geometry.coordinates))
                                },
                            )
                            put(
                                "properties",
                                buildJsonObject {
                                    feature.properties.forEach { (key, value) ->
                                        put(key, jsonValue(value))
                                    }
                                },
                            )
                        },
                    )
                }
            },
        )
    }.toString()

fun selectionGeoJson(hit: SearchHit): String? {
    val lon = hit.lon ?: return null
    val lat = hit.lat ?: return null
    return buildJsonObject {
        put("type", "FeatureCollection")
        put(
            "features",
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("type", "Feature")
                        put(
                            "geometry",
                            buildJsonObject {
                                put("type", "Point")
                                put(
                                    "coordinates",
                                    buildJsonArray {
                                        add(JsonPrimitive(lon))
                                        add(JsonPrimitive(lat))
                                    },
                                )
                            },
                        )
                        put("properties", buildJsonObject { put("id", hit.id) })
                    },
                )
            },
        )
    }.toString()
}

fun FeatureCollection.positions(): List<Pair<Double, Double>> {
    val found = mutableListOf<Pair<Double, Double>>()
    features.forEach { feature -> collectPositions(feature.geometry.coordinates, found) }
    return found
}

private fun collectPositions(value: Any?, out: MutableList<Pair<Double, Double>>) {
    val list = value as? List<*> ?: return
    val lon = (list.getOrNull(0) as? Number)?.toDouble()
    val lat = (list.getOrNull(1) as? Number)?.toDouble()
    if (lon != null && lat != null && list.getOrNull(0) !is List<*>) {
        out += lon to lat
        return
    }
    list.forEach { collectPositions(it, out) }
}

private fun jsonValue(value: Any?): JsonElement = when (value) {
    null -> JsonNull
    is String -> JsonPrimitive(value)
    is Boolean -> JsonPrimitive(value)
    is Int -> JsonPrimitive(value)
    is Long -> JsonPrimitive(value)
    is Double -> JsonPrimitive(value)
    is Float -> JsonPrimitive(value)
    is Number -> JsonPrimitive(value.toDouble())
    is Geometry.Type -> JsonPrimitive(value.value)
    is List<*> -> JsonArray(value.map { jsonValue(it) })
    is Map<*, *> -> buildJsonObject {
        value.forEach { (key, nested) ->
            if (key is String) put(key, jsonValue(nested))
        }
    }
    else -> JsonPrimitive(value.toString())
}

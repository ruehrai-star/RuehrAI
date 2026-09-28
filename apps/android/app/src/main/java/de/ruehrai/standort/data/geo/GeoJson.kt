package de.ruehrai.standort.data.geo

import de.ruehrai.standort.data.model.SearchHit
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

fun featureCount(geoJson: String): Int {
    val root = Json.parseToJsonElement(geoJson).jsonObject
    val type = root["type"]?.jsonPrimitive?.contentOrNull
    check(type == "FeatureCollection") { "Expected a GeoJSON FeatureCollection" }
    return root.getValue("features").jsonArray.size
}

fun selectionGeoJson(hit: SearchHit): String =
    buildJsonObject {
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
                                        add(JsonPrimitive(hit.longitude))
                                        add(JsonPrimitive(hit.latitude))
                                    },
                                )
                            },
                        )
                        put(
                            "properties",
                            buildJsonObject {
                                put("id", hit.id)
                            },
                        )
                    },
                )
            },
        )
    }.toString()

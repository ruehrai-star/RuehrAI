package de.ruehrai.standort.data.json

import kotlinx.serialization.json.Json

val StandortJson: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
}

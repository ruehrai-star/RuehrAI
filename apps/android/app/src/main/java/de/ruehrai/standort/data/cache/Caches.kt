package de.ruehrai.standort.data.cache

import de.ruehrai.api.models.FeatureCollection
import de.ruehrai.api.models.SearchResponse

interface SearchCache {
    suspend fun read(key: String): SearchResponse?

    suspend fun write(key: String, response: SearchResponse)
}

interface LayerCache {
    suspend fun read(id: String): FeatureCollection?

    suspend fun write(id: String, layer: FeatureCollection)
}

class InMemorySearchCache : SearchCache {
    private val rows = mutableMapOf<String, SearchResponse>()

    override suspend fun read(key: String): SearchResponse? = rows[key]

    override suspend fun write(key: String, response: SearchResponse) {
        rows[key] = response
    }
}

class InMemoryLayerCache : LayerCache {
    private val rows = mutableMapOf<String, FeatureCollection>()

    override suspend fun read(id: String): FeatureCollection? = rows[id]

    override suspend fun write(id: String, layer: FeatureCollection) {
        rows[id] = layer
    }
}

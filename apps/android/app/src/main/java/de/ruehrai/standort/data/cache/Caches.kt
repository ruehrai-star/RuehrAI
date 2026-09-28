package de.ruehrai.standort.data.cache

import de.ruehrai.standort.data.model.LayerResponse
import de.ruehrai.standort.data.model.SearchResponse

/** Small offline hook. The shell reads the mock through this cache. */
interface SearchCache {
    suspend fun read(key: String): SearchResponse?

    suspend fun write(key: String, response: SearchResponse)
}

interface LayerCache {
    suspend fun read(id: String): LayerResponse?

    suspend fun write(layer: LayerResponse)
}

class InMemorySearchCache : SearchCache {
    private val rows = mutableMapOf<String, SearchResponse>()

    override suspend fun read(key: String): SearchResponse? = rows[key]

    override suspend fun write(key: String, response: SearchResponse) {
        rows[key] = response
    }
}

class InMemoryLayerCache : LayerCache {
    private val rows = mutableMapOf<String, LayerResponse>()

    override suspend fun read(id: String): LayerResponse? = rows[id]

    override suspend fun write(layer: LayerResponse) {
        rows[layer.id] = layer
    }
}

package de.ruehrai.standort.data.repo

import de.ruehrai.api.models.Credentials
import de.ruehrai.api.models.FeatureCollection
import de.ruehrai.api.models.HealthResponse
import de.ruehrai.api.models.SearchResponse
import de.ruehrai.api.models.TokenResponse
import de.ruehrai.api.models.User
import de.ruehrai.standort.data.api.StandortApi
import de.ruehrai.standort.data.cache.LayerCache
import de.ruehrai.standort.data.cache.SearchCache
import de.ruehrai.standort.data.model.SearchQuery

class StandortRepository(
    private val api: StandortApi,
    private val searchCache: SearchCache,
    private val layerCache: LayerCache,
) {
    suspend fun login(email: String, password: String): TokenResponse =
        api.login(Credentials(email = email.trim(), password = password))

    suspend fun register(email: String, password: String): TokenResponse =
        api.register(Credentials(email = email.trim(), password = password))

    suspend fun currentUser(): User = api.currentUser()

    suspend fun health(): HealthResponse = api.health()

    suspend fun search(query: SearchQuery): SearchResponse {
        val key = query.cacheKey()
        searchCache.read(key)?.let { return it }
        val fresh = api.search(query)
        searchCache.write(key, fresh)
        return fresh
    }

    suspend fun layer(id: String): FeatureCollection {
        layerCache.read(id)?.let { return it }
        val fresh = api.getLayer(id)
        layerCache.write(id, fresh)
        return fresh
    }
}

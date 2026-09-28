package de.ruehrai.standort.data.repo

import de.ruehrai.standort.data.api.StandortApi
import de.ruehrai.standort.data.cache.LayerCache
import de.ruehrai.standort.data.cache.SearchCache
import de.ruehrai.standort.data.model.AuthSession
import de.ruehrai.standort.data.model.LayerResponse
import de.ruehrai.standort.data.model.LoginRequest
import de.ruehrai.standort.data.model.SearchResponse

class StandortRepository(
    private val api: StandortApi,
    private val searchCache: SearchCache,
    private val layerCache: LayerCache,
) {
    suspend fun login(email: String, password: String): AuthSession =
        api.login(LoginRequest(email = email.trim(), password = password))

    suspend fun search(query: String): SearchResponse {
        val trimmed = query.trim()
        val key = trimmed.lowercase()
        searchCache.read(key)?.let { return it }
        val fresh = api.search(trimmed)
        searchCache.write(key, fresh)
        return fresh
    }

    suspend fun layer(id: String): LayerResponse {
        layerCache.read(id)?.let { return it }
        val fresh = api.getLayer(id)
        layerCache.write(fresh)
        return fresh
    }
}

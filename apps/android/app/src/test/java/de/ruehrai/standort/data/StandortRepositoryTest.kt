package de.ruehrai.standort.data

import de.ruehrai.standort.data.api.MockStandortApi
import de.ruehrai.standort.data.api.StandortApi
import de.ruehrai.standort.data.cache.InMemoryLayerCache
import de.ruehrai.standort.data.cache.InMemorySearchCache
import de.ruehrai.standort.data.model.AuthSession
import de.ruehrai.standort.data.model.LayerResponse
import de.ruehrai.standort.data.model.LoginRequest
import de.ruehrai.standort.data.model.SearchResponse
import de.ruehrai.standort.data.model.StandortEndpoints
import de.ruehrai.standort.data.repo.StandortRepository
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

class StandortRepositoryTest {
    @Test
    fun searchUsesCacheOnSecondCall() = runBlocking {
        val api = CountingApi(MockStandortApi())
        val repository = StandortRepository(
            api = api,
            searchCache = InMemorySearchCache(),
            layerCache = InMemoryLayerCache(),
        )

        val first = repository.search("  Essen ")
        val second = repository.search("essen")

        assertEquals(first.results, second.results)
        assertEquals(1, api.searchCalls)
    }

    @Test
    fun layerUsesCacheOnSecondCall() = runBlocking {
        val api = CountingApi(MockStandortApi())
        val repository = StandortRepository(
            api = api,
            searchCache = InMemorySearchCache(),
            layerCache = InMemoryLayerCache(),
        )

        repository.layer(StandortEndpoints.SAMPLE_LAYER_ID)
        repository.layer(StandortEndpoints.SAMPLE_LAYER_ID)

        assertEquals(1, api.layerCalls)
    }
}

private class CountingApi(
    private val delegate: StandortApi,
) : StandortApi {
    var searchCalls: Int = 0
    var layerCalls: Int = 0

    override suspend fun login(request: LoginRequest): AuthSession = delegate.login(request)

    override suspend fun search(query: String): SearchResponse {
        searchCalls += 1
        return delegate.search(query)
    }

    override suspend fun getLayer(id: String): LayerResponse {
        layerCalls += 1
        return delegate.getLayer(id)
    }
}

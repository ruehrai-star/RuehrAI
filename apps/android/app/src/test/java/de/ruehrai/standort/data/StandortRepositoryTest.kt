package de.ruehrai.standort.data

import de.ruehrai.api.models.Credentials
import de.ruehrai.api.models.FeatureCollection
import de.ruehrai.api.models.HealthResponse
import de.ruehrai.api.models.SearchResponse
import de.ruehrai.api.models.TokenResponse
import de.ruehrai.api.models.User
import de.ruehrai.standort.data.api.MockStandortApi
import de.ruehrai.standort.data.api.StandortApi
import de.ruehrai.standort.data.cache.InMemoryLayerCache
import de.ruehrai.standort.data.cache.InMemorySearchCache
import de.ruehrai.standort.data.model.DemoLayers
import de.ruehrai.standort.data.model.SearchQuery
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
        val query = SearchQuery(q = "München")

        val first = repository.search(query)
        val second = repository.search(query)

        assertEquals(first.hits, second.hits)
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

        repository.layer(DemoLayers.GEMEINDEN)
        repository.layer(DemoLayers.GEMEINDEN)

        assertEquals(1, api.layerCalls)
    }
}

private class CountingApi(
    private val delegate: StandortApi,
) : StandortApi {
    var searchCalls: Int = 0
    var layerCalls: Int = 0

    override suspend fun login(credentials: Credentials): TokenResponse = delegate.login(credentials)

    override suspend fun register(credentials: Credentials): TokenResponse = delegate.register(credentials)

    override suspend fun currentUser(): User = delegate.currentUser()

    override suspend fun search(query: SearchQuery): SearchResponse {
        searchCalls += 1
        return delegate.search(query)
    }

    override suspend fun getLayer(id: String): FeatureCollection {
        layerCalls += 1
        return delegate.getLayer(id)
    }

    override suspend fun health(): HealthResponse = delegate.health()
}

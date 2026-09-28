package de.ruehrai.standort.data

import de.ruehrai.api.models.Credentials
import de.ruehrai.api.models.Grain
import de.ruehrai.api.models.SearchType
import de.ruehrai.api.models.TokenResponse
import de.ruehrai.standort.data.api.MockStandortApi
import de.ruehrai.standort.data.model.ApiError
import de.ruehrai.standort.data.model.DemoLayers
import de.ruehrai.standort.data.model.SearchQuery
import de.ruehrai.standort.data.model.StandortApiException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MockStandortApiTest {
    private val api = MockStandortApi()

    @Test
    fun loginAcceptsEmailAndLongPassword() = runBlocking {
        val token = api.login(Credentials(email = "dev@ruehrai.local", password = "dev-password"))
        assertEquals("mock-session-token", token.accessToken)
        assertEquals(TokenResponse.TokenType.BEARER, token.tokenType)
        assertTrue(token.expiresIn > 0)
        assertEquals("dev@ruehrai.local", api.currentUser().email)
    }

    @Test
    fun loginRejectsShortPassword() {
        val error = assertApiError {
            api.login(Credentials(email = "dev@ruehrai.local", password = "short"))
        }
        assertEquals(ApiError.INVALID_CREDENTIALS, error)
    }

    @Test
    fun searchMatchesLabelAgsAndPlz() = runBlocking {
        val muenchen = api.search(SearchQuery(q = "München"))
        assertTrue(muenchen.hits.any { it.grain == Grain.AGS && it.geoKey == "09162000" })
        assertTrue(muenchen.hits.any { it.grain == Grain.ADDRESS && it.label.contains("Marienplatz") })
        assertTrue(muenchen.hits.any { it.grain == Grain.PLZ5 && it.geoKey == "80331" })

        val ags = api.search(SearchQuery(q = "09162000", type = SearchType.AGS))
        assertEquals(listOf("09162000"), ags.hits.map { it.geoKey })

        val plz = api.search(SearchQuery(plz = "80331"))
        assertEquals(Grain.PLZ5, plz.hits.single().grain)
        assertEquals(11.5760, plz.hits.single().lon!!, 0.0001)
        assertEquals(48.1370, plz.hits.single().lat!!, 0.0001)
    }

    @Test
    fun typeFilterLimitsGrain() = runBlocking {
        val addresses = api.search(SearchQuery(q = "München", type = SearchType.ADDRESS))
        assertTrue(addresses.hits.isNotEmpty())
        assertTrue(addresses.hits.all { it.grain == Grain.ADDRESS })
    }

    @Test
    fun emptyQueryReturnsCatalog() = runBlocking {
        val hits = api.search(SearchQuery(q = "   ")).hits
        assertTrue(hits.size >= 7)
        assertEquals(hits.map { it.label }, hits.map { it.label }.sorted())
    }

    @Test
    fun demoGemeindenLayerIsFeatureCollection() = runBlocking {
        val layer = api.getLayer(DemoLayers.GEMEINDEN)
        assertEquals("Demo-Gemeinden", layer.name)
        assertEquals(3, layer.features.size)
    }

    @Test
    fun unknownLayerFails() {
        val error = assertApiError { api.getLayer("ruhr-gemeinden") }
        assertEquals(ApiError.NOT_FOUND, error)
    }

    private fun assertApiError(block: suspend () -> Unit): ApiError {
        val error = runCatching { runBlocking { block() } }.exceptionOrNull()
        assertTrue(error is StandortApiException)
        return (error as StandortApiException).code
    }
}

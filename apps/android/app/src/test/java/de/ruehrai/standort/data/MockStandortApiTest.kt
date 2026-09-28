package de.ruehrai.standort.data

import de.ruehrai.standort.data.api.MockStandortApi
import de.ruehrai.standort.data.api.OpenApiStandortApi
import de.ruehrai.standort.data.api.StandortApiFactory
import de.ruehrai.standort.data.api.StandortApiMode
import de.ruehrai.standort.data.geo.featureCount
import de.ruehrai.standort.data.model.ApiError
import de.ruehrai.standort.data.model.LoginRequest
import de.ruehrai.standort.data.model.SearchKind
import de.ruehrai.standort.data.model.StandortApiException
import de.ruehrai.standort.data.model.StandortEndpoints
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MockStandortApiTest {
    private val api = MockStandortApi()

    @Test
    fun loginAcceptsPlaceholderCredentials() = runBlocking {
        val session = api.login(LoginRequest("demo@ruehrai.de", "standort"))
        assertEquals("Bearer", session.tokenType)
        assertEquals("mock-session-token", session.accessToken)
        assertTrue(session.expiresInSeconds > 0)
    }

    @Test
    fun loginRejectsShortPassword() {
        val error = assertApiError {
            api.login(LoginRequest("demo@ruehrai.de", "short"))
        }
        assertEquals(ApiError.INVALID_CREDENTIALS, error)
    }

    @Test
    fun searchMatchesAddressAgsAndPlz() = runBlocking {
        val essen = api.search("Essen")
        assertTrue(essen.results.any { it.kind == SearchKind.ADDRESS && it.label.contains("Essen") })

        val ags = api.search("05113000")
        assertTrue(ags.results.any { it.kind == SearchKind.AGS && it.ags == "05113000" })

        val plz = api.search("45127")
        assertTrue(plz.results.any { it.kind == SearchKind.PLZ && it.plz == "45127" })
        assertTrue(plz.results.any { it.kind == SearchKind.ADDRESS })
    }

    @Test
    fun blankSearchReturnsNoHits() = runBlocking {
        assertTrue(api.search("   ").results.isEmpty())
    }

    @Test
    fun sampleLayerIsGeoJsonFeatureCollection() = runBlocking {
        val layer = api.getLayer(StandortEndpoints.SAMPLE_LAYER_ID)
        assertEquals("ruhr-gemeinden", layer.id)
        assertEquals(3, featureCount(layer.geoJson))
    }

    @Test
    fun unknownLayerFails() {
        val error = assertApiError { api.getLayer("missing") }
        assertEquals(ApiError.LAYER_NOT_FOUND, error)
    }

    @Test
    fun openApiModePointsAtContractsPackage() {
        val client = StandortApiFactory.create(StandortApiMode.OPENAPI)
        assertTrue(client is OpenApiStandortApi)
        val message = runCatching { runBlocking { client.search("Essen") } }.exceptionOrNull()?.message
        assertTrue(message?.contains("packages/api-contracts") == true)
    }

    private fun assertApiError(block: suspend () -> Unit): ApiError {
        val error = runCatching { runBlocking { block() } }.exceptionOrNull()
        assertTrue(error is StandortApiException)
        return (error as StandortApiException).code
    }
}

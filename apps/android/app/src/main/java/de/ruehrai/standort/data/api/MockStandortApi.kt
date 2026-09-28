package de.ruehrai.standort.data.api

import de.ruehrai.standort.data.model.ApiError
import de.ruehrai.standort.data.model.AuthSession
import de.ruehrai.standort.data.model.LayerResponse
import de.ruehrai.standort.data.model.LoginRequest
import de.ruehrai.standort.data.model.SearchHit
import de.ruehrai.standort.data.model.SearchResponse
import de.ruehrai.standort.data.model.StandortApiException
import de.ruehrai.standort.data.sample.SampleCatalog

/**
 * In-process stand-in for Backend OpenAPI v0. No network and no Supabase.
 */
class MockStandortApi : StandortApi {
    override suspend fun login(request: LoginRequest): AuthSession {
        if (!isAcceptableEmail(request.email) || request.password.length < MIN_PASSWORD_LENGTH) {
            throw StandortApiException(
                ApiError.INVALID_CREDENTIALS,
                "E-Mail oder Passwort ist ungültig.",
            )
        }
        return AuthSession(
            accessToken = "mock-session-token",
            tokenType = "Bearer",
            expiresInSeconds = 3600,
        )
    }

    override suspend fun search(query: String): SearchResponse {
        val trimmed = query.trim()
        if (trimmed.isEmpty()) {
            return SearchResponse(query = trimmed, results = emptyList())
        }
        val needle = trimmed.lowercase()
        val results = SampleCatalog.hits.filter { it.matches(needle) }
        return SearchResponse(query = trimmed, results = results)
    }

    override suspend fun getLayer(id: String): LayerResponse {
        val layer = SampleCatalog.layers[id]
            ?: throw StandortApiException(
                ApiError.LAYER_NOT_FOUND,
                "Layer $id ist im Mock nicht vorhanden.",
            )
        return LayerResponse(id = layer.id, name = layer.name, geoJson = layer.geoJson)
    }

    private fun isAcceptableEmail(value: String): Boolean {
        val at = value.indexOf('@')
        if (at <= 0) return false
        val dot = value.indexOf('.', startIndex = at + 1)
        return dot > at + 1 && dot < value.lastIndex
    }

    private fun SearchHit.matches(needle: String): Boolean =
        listOfNotNull(label, subtitle, ags, plz, id).any { it.lowercase().contains(needle) }

    private companion object {
        const val MIN_PASSWORD_LENGTH = 8
    }
}

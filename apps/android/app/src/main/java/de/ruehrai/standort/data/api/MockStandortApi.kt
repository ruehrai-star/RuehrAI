package de.ruehrai.standort.data.api

import de.ruehrai.api.models.Credentials
import de.ruehrai.api.models.FeatureCollection
import de.ruehrai.api.models.Grain
import de.ruehrai.api.models.HealthResponse
import de.ruehrai.api.models.SearchHit
import de.ruehrai.api.models.SearchResponse
import de.ruehrai.api.models.SearchType
import de.ruehrai.api.models.TokenResponse
import de.ruehrai.api.models.User
import de.ruehrai.standort.data.model.ApiError
import de.ruehrai.standort.data.model.SearchQuery
import de.ruehrai.standort.data.model.StandortApiException
import de.ruehrai.standort.data.sample.SampleCatalog

/**
 * Offline stand-in with the same schemas as OpenAPI v0.
 * Any email and a password of at least 8 characters succeed.
 */
class MockStandortApi : StandortApi {
    private var signedInEmail: String? = null

    override suspend fun login(credentials: Credentials): TokenResponse = tokenFor(credentials)

    override suspend fun register(credentials: Credentials): TokenResponse = tokenFor(credentials)

    override suspend fun currentUser(): User {
        val email = signedInEmail
            ?: throw StandortApiException(ApiError.UNAUTHORIZED, "Nicht angemeldet.")
        return User(id = "1", email = email)
    }

    override suspend fun search(query: SearchQuery): SearchResponse {
        val hits = SampleCatalog.hits
            .filter { it.matches(query) }
            .sortedBy { it.label }
            .take(MAX_HITS)
        return SearchResponse(hits = hits)
    }

    override suspend fun getLayer(id: String): FeatureCollection =
        SampleCatalog.layers[id]
            ?: throw StandortApiException(ApiError.NOT_FOUND, "Layer $id ist im Mock nicht vorhanden.")

    override suspend fun health(): HealthResponse = HealthResponse(status = HealthResponse.Status.OK)

    private fun tokenFor(credentials: Credentials): TokenResponse {
        if (!isEmail(credentials.email) || credentials.password.length < MIN_PASSWORD_LENGTH) {
            throw StandortApiException(ApiError.INVALID_CREDENTIALS, "E-Mail oder Passwort ist ungültig.")
        }
        signedInEmail = credentials.email.trim()
        return TokenResponse(
            accessToken = "mock-session-token",
            tokenType = TokenResponse.TokenType.BEARER,
            expiresIn = 28800,
        )
    }

    private fun isEmail(value: String): Boolean {
        val at = value.indexOf('@')
        if (at <= 0) return false
        val dot = value.indexOf('.', startIndex = at + 1)
        return dot > at + 1 && dot < value.lastIndex
    }

    private fun SearchHit.matches(query: SearchQuery): Boolean {
        val q = query.q?.trim().orEmpty()
        if (q.isNotEmpty()) {
            val grainOk = when (query.type) {
                null -> true
                SearchType.ADDRESS -> grain == Grain.ADDRESS
                SearchType.AGS -> grain == Grain.AGS || grain == Grain.AGS5
                SearchType.PLZ -> grain == Grain.PLZ5 || grain == Grain.PLZ8
            }
            if (!grainOk) return false
            val haystack = listOfNotNull(label, geoKey).joinToString(" ").lowercase()
            if (!haystack.contains(q.lowercase())) return false
        }
        query.address?.let { address ->
            val haystack = listOfNotNull(label, geoKey).joinToString(" ").lowercase()
            if (!haystack.contains(address.lowercase())) return false
        }
        query.ags?.let { ags ->
            if (grain != Grain.AGS && grain != Grain.AGS5) return false
            if (geoKey != ags) return false
        }
        query.plz?.let { plz ->
            if (grain != Grain.PLZ5 && grain != Grain.PLZ8) return false
            if (geoKey != plz) return false
        }
        query.geoKey?.let { key ->
            if (geoKey != key) return false
        }
        query.grain?.let { expected ->
            if (grain != expected) return false
        }
        return true
    }

    private companion object {
        const val MIN_PASSWORD_LENGTH = 8
        const val MAX_HITS = 50
    }
}

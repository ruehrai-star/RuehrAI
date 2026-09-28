package de.ruehrai.standort.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Hand-written stand-in for the Backend OpenAPI v0 slice.
 *
 * JSON names follow the expected HTTP shape so a generated client from
 * `packages/api-contracts` can replace the mock without a UI rewrite.
 */
@Serializable
data class LoginRequest(
    val email: String,
    val password: String,
)

@Serializable
data class AuthSession(
    @SerialName("access_token") val accessToken: String,
    @SerialName("token_type") val tokenType: String,
    @SerialName("expires_in") val expiresInSeconds: Long,
)

@Serializable
enum class SearchKind {
    @SerialName("address") ADDRESS,
    @SerialName("ags") AGS,
    @SerialName("plz") PLZ,
}

@Serializable
data class SearchHit(
    val id: String,
    val kind: SearchKind,
    val label: String,
    val subtitle: String,
    val latitude: Double,
    val longitude: Double,
    val ags: String? = null,
    val plz: String? = null,
)

@Serializable
data class SearchResponse(
    val query: String,
    val results: List<SearchHit>,
)

@Serializable
data class LayerResponse(
    val id: String,
    val name: String,
    val geoJson: String,
)

enum class ApiError {
    INVALID_CREDENTIALS,
    LAYER_NOT_FOUND,
}

class StandortApiException(
    val code: ApiError,
    message: String,
) : Exception(message)

/** Paths this shell will call once Backend OpenAPI v0 exists. */
object StandortEndpoints {
    const val LOGIN = "POST /auth/login"
    const val SEARCH = "GET /search"
    const val LAYER = "GET /layers/{id}"
    const val SAMPLE_LAYER_ID = "ruhr-gemeinden"
}

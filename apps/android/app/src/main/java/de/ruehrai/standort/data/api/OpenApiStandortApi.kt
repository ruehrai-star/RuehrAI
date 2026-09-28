package de.ruehrai.standort.data.api

import de.ruehrai.api.apis.AuthApi
import de.ruehrai.api.apis.HealthApi
import de.ruehrai.api.apis.LayersApi
import de.ruehrai.api.apis.SearchApi
import de.ruehrai.api.infrastructure.ApiClient
import de.ruehrai.api.infrastructure.ClientException
import de.ruehrai.api.infrastructure.ServerException
import de.ruehrai.api.models.Credentials
import de.ruehrai.api.models.FeatureCollection
import de.ruehrai.api.models.HealthResponse
import de.ruehrai.api.models.SearchResponse
import de.ruehrai.api.models.TokenResponse
import de.ruehrai.api.models.User
import de.ruehrai.standort.data.model.ApiError
import de.ruehrai.standort.data.model.SearchQuery
import de.ruehrai.standort.data.model.StandortApiException
import de.ruehrai.standort.data.settings.ApiSettings
import java.io.IOException
import java.util.concurrent.TimeUnit
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient

/**
 * Live calls through the OpenAPI Generator Kotlin client
 * (`de.ruehrai.api`, Moshi + OkHttp), produced at build time from
 * `packages/api-contracts/openapi/openapi.yaml`.
 */
class OpenApiStandortApi(
    private val settings: ApiSettings,
) : StandortApi {
    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    override suspend fun login(credentials: Credentials): TokenResponse = call(::authStatus) {
        val token = AuthApi(baseUrl(), http).login(credentials)
        ApiClient.accessToken = token.accessToken
        token
    }

    override suspend fun register(credentials: Credentials): TokenResponse = call(::authStatus) {
        val token = AuthApi(baseUrl(), http).register(credentials)
        ApiClient.accessToken = token.accessToken
        token
    }

    override suspend fun currentUser(): User = call {
        AuthApi(baseUrl(), http).getCurrentUser()
    }

    override suspend fun search(query: SearchQuery): SearchResponse = call {
        SearchApi(baseUrl(), http).searchPlaces(
            q = query.q,
            type = query.type,
            address = query.address,
            ags = query.ags,
            plz = query.plz,
            geoKey = query.geoKey,
            grain = query.grain,
        )
    }

    override suspend fun getLayer(id: String): FeatureCollection = call {
        LayersApi(baseUrl(), http).getLayer(id)
    }

    override suspend fun health(): HealthResponse = call {
        HealthApi(baseUrl(), http).getHealth()
    }

    private fun baseUrl(): String {
        val url = settings.baseUrl.trim().trimEnd('/')
        if (url.toHttpUrlOrNull() == null) {
            throw StandortApiException(ApiError.BAD_REQUEST, "Base URL ist ungültig.")
        }
        return url
    }

    private suspend fun <T> call(
        mapStatus: (Int) -> ApiError = ::codeFor,
        block: suspend () -> T,
    ): T =
        try {
            block()
        } catch (error: StandortApiException) {
            throw error
        } catch (error: ClientException) {
            throw StandortApiException(mapStatus(error.statusCode), error.message ?: "Client-Fehler")
        } catch (error: ServerException) {
            throw StandortApiException(ApiError.UNKNOWN, error.message ?: "Server-Fehler")
        } catch (_: IOException) {
            throw StandortApiException(ApiError.NETWORK, "Backend nicht erreichbar.")
        }

    private fun authStatus(status: Int): ApiError = when (status) {
        401 -> ApiError.INVALID_CREDENTIALS
        409 -> ApiError.CONFLICT
        else -> codeFor(status)
    }

    private fun codeFor(status: Int): ApiError = when (status) {
        400 -> ApiError.BAD_REQUEST
        401 -> ApiError.UNAUTHORIZED
        404 -> ApiError.NOT_FOUND
        409 -> ApiError.CONFLICT
        else -> ApiError.UNKNOWN
    }
}

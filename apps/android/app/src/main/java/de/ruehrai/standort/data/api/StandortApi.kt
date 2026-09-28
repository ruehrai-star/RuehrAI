package de.ruehrai.standort.data.api

import de.ruehrai.api.models.Credentials
import de.ruehrai.api.models.FeatureCollection
import de.ruehrai.api.models.HealthResponse
import de.ruehrai.api.models.SearchResponse
import de.ruehrai.api.models.TokenResponse
import de.ruehrai.api.models.User
import de.ruehrai.standort.data.model.SearchQuery

/**
 * Backend OpenAPI v0 surface. The live implementation is the client generated
 * from `packages/api-contracts/openapi/openapi.yaml`. Auth is that API's JWT.
 * This module does not use a Supabase SDK.
 */
interface StandortApi {
    suspend fun login(credentials: Credentials): TokenResponse

    suspend fun register(credentials: Credentials): TokenResponse

    suspend fun currentUser(): User

    suspend fun search(query: SearchQuery): SearchResponse

    suspend fun getLayer(id: String): FeatureCollection

    suspend fun health(): HealthResponse
}

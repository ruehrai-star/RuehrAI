package de.ruehrai.standort.data.api

import de.ruehrai.standort.data.model.AuthSession
import de.ruehrai.standort.data.model.LayerResponse
import de.ruehrai.standort.data.model.LoginRequest
import de.ruehrai.standort.data.model.SearchResponse

/**
 * Client surface for the agreed Backend slice.
 *
 * Implementations:
 * - [MockStandortApi] until OpenAPI v0 is published
 * - [OpenApiStandortApi] once a client is generated from `packages/api-contracts`
 *
 * Auth is Backend JWT/session only. This module must not depend on a Supabase SDK.
 */
interface StandortApi {
    suspend fun login(request: LoginRequest): AuthSession

    suspend fun search(query: String): SearchResponse

    suspend fun getLayer(id: String): LayerResponse
}

package de.ruehrai.standort.data.api

/**
 * Switch [mode] to [StandortApiMode.OPENAPI] after Backend lands OpenAPI v0
 * under `packages/api-contracts` and a generator is wired in this module.
 * This repository does not contain that package yet, so the default stays mock.
 */
enum class StandortApiMode {
    MOCK,
    OPENAPI,
}

object StandortApiFactory {
    fun create(mode: StandortApiMode = StandortApiMode.MOCK): StandortApi =
        when (mode) {
            StandortApiMode.MOCK -> MockStandortApi()
            StandortApiMode.OPENAPI -> OpenApiStandortApi()
        }
}

/**
 * Placeholder for the generated client. Calling it fails loudly so the shell
 * cannot silently talk to the wrong backend.
 */
class OpenApiStandortApi : StandortApi {
    override suspend fun login(request: de.ruehrai.standort.data.model.LoginRequest) = notReady()

    override suspend fun search(query: String) = notReady()

    override suspend fun getLayer(id: String) = notReady()

    private fun notReady(): Nothing =
        error(
            "Generated OpenAPI client is not available. Generate it from " +
                "packages/api-contracts when Backend OpenAPI v0 lands, then return " +
                "that client from StandortApiFactory.",
        )
}

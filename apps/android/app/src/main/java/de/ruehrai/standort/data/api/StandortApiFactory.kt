package de.ruehrai.standort.data.api

import de.ruehrai.standort.data.settings.ApiSettings

/**
 * Live OpenAPI client unless [ApiSettings.useMock] is set (login screen or
 * Gradle `-Pruehrai.useMockApi=true`).
 */
object StandortApiFactory {
    fun create(settings: ApiSettings): StandortApi =
        SwitchingStandortApi(
            live = OpenApiStandortApi(settings),
            mock = MockStandortApi(),
            settings = settings,
        )
}

class SwitchingStandortApi(
    private val live: StandortApi,
    private val mock: StandortApi,
    private val settings: ApiSettings,
) : StandortApi {
    private fun current(): StandortApi = if (settings.useMock) mock else live

    override suspend fun login(credentials: de.ruehrai.api.models.Credentials) = current().login(credentials)

    override suspend fun register(credentials: de.ruehrai.api.models.Credentials) = current().register(credentials)

    override suspend fun currentUser() = current().currentUser()

    override suspend fun search(query: de.ruehrai.standort.data.model.SearchQuery) = current().search(query)

    override suspend fun getLayer(id: String) = current().getLayer(id)

    override suspend fun health() = current().health()
}

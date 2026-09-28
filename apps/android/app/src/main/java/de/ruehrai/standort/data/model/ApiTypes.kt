package de.ruehrai.standort.data.model

import de.ruehrai.api.models.Grain
import de.ruehrai.api.models.SearchType

/** Query string of `GET /search`. Empty fields are omitted. */
data class SearchQuery(
    val q: String? = null,
    val type: SearchType? = null,
    val address: String? = null,
    val ags: String? = null,
    val plz: String? = null,
    val geoKey: String? = null,
    val grain: Grain? = null,
) {
    fun cacheKey(): String = listOf(
        q.orEmpty(),
        type?.value.orEmpty(),
        address.orEmpty(),
        ags.orEmpty(),
        plz.orEmpty(),
        geoKey.orEmpty(),
        grain?.value.orEmpty(),
    ).joinToString("\u001f")
}

enum class ApiError {
    INVALID_CREDENTIALS,
    CONFLICT,
    NOT_FOUND,
    BAD_REQUEST,
    UNAUTHORIZED,
    NETWORK,
    UNKNOWN,
}

class StandortApiException(
    val code: ApiError,
    message: String,
) : Exception(message)

/** Layer ids seeded by the Backend dev migration. */
object DemoLayers {
    const val GEMEINDEN = "demo-gemeinden"
    const val PLZ = "demo-plz"
    const val GRID100 = "demo-grid100"
    val ids = listOf(GEMEINDEN, PLZ, GRID100)
}

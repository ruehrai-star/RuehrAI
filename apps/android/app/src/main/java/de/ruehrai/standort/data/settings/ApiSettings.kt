package de.ruehrai.standort.data.settings

import android.content.Context
import de.ruehrai.standort.BuildConfig

/**
 * Runtime switch between the generated HTTP client and the offline mock.
 * Defaults come from Gradle (`ruehrai.apiBaseUrl`, `ruehrai.useMockApi`).
 * The live client is the primary path.
 */
class ApiSettings(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    var useMock: Boolean
        get() = prefs.getBoolean(KEY_USE_MOCK, BuildConfig.USE_MOCK_API)
        set(value) {
            prefs.edit().putBoolean(KEY_USE_MOCK, value).apply()
        }

    var baseUrl: String
        get() = prefs.getString(KEY_BASE_URL, null) ?: BuildConfig.API_BASE_URL
        set(value) {
            prefs.edit().putString(KEY_BASE_URL, value.trim().trimEnd('/')).apply()
        }

    private companion object {
        const val PREFS = "standort-api"
        const val KEY_USE_MOCK = "use_mock"
        const val KEY_BASE_URL = "base_url"
    }
}

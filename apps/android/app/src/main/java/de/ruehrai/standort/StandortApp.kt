package de.ruehrai.standort

import android.app.Application
import de.ruehrai.standort.di.AppContainer
import org.maplibre.android.MapLibre

class StandortApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        MapLibre.getInstance(this)
        container = AppContainer(this)
    }
}

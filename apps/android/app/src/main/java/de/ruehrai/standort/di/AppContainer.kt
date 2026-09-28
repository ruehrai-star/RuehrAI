package de.ruehrai.standort.di

import android.content.Context
import de.ruehrai.standort.data.api.StandortApiFactory
import de.ruehrai.standort.data.local.RoomLayerCache
import de.ruehrai.standort.data.local.RoomSearchCache
import de.ruehrai.standort.data.local.createAppDatabase
import de.ruehrai.standort.data.repo.StandortRepository
import de.ruehrai.standort.data.settings.ApiSettings

class AppContainer(context: Context) {
    private val database = createAppDatabase(context.applicationContext)
    val settings = ApiSettings(context)

    val repository: StandortRepository = StandortRepository(
        api = StandortApiFactory.create(settings),
        searchCache = RoomSearchCache(database.searchCacheDao()),
        layerCache = RoomLayerCache(database.layerCacheDao()),
    )
}

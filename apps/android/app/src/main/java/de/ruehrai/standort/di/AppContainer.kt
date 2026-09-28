package de.ruehrai.standort.di

import android.content.Context
import de.ruehrai.standort.data.api.StandortApiFactory
import de.ruehrai.standort.data.local.RoomLayerCache
import de.ruehrai.standort.data.local.RoomSearchCache
import de.ruehrai.standort.data.local.createAppDatabase
import de.ruehrai.standort.data.repo.StandortRepository

class AppContainer(context: Context) {
    private val database = createAppDatabase(context.applicationContext)

    val repository: StandortRepository = StandortRepository(
        api = StandortApiFactory.create(),
        searchCache = RoomSearchCache(database.searchCacheDao()),
        layerCache = RoomLayerCache(database.layerCacheDao()),
    )
}

package de.ruehrai.standort.data.local

import android.content.Context
import androidx.room.Room
import de.ruehrai.standort.data.cache.LayerCache
import de.ruehrai.standort.data.cache.SearchCache
import de.ruehrai.standort.data.json.StandortJson
import de.ruehrai.standort.data.model.LayerResponse
import de.ruehrai.standort.data.model.SearchResponse
import kotlinx.serialization.json.Json

fun createAppDatabase(context: Context): AppDatabase =
    Room.databaseBuilder(context, AppDatabase::class.java, "standort-cache.db")
        .fallbackToDestructiveMigration(dropAllTables = true)
        .build()

class RoomSearchCache(
    private val dao: SearchCacheDao,
    private val json: Json = StandortJson,
    private val now: () -> Long = System::currentTimeMillis,
) : SearchCache {
    override suspend fun read(key: String): SearchResponse? {
        val row = dao.find(key) ?: return null
        return json.decodeFromString(SearchResponse.serializer(), row.payloadJson)
    }

    override suspend fun write(key: String, response: SearchResponse) {
        dao.upsert(
            SearchCacheEntity(
                query = key,
                payloadJson = json.encodeToString(SearchResponse.serializer(), response),
                cachedAtEpochMs = now(),
            ),
        )
    }
}

class RoomLayerCache(
    private val dao: LayerCacheDao,
    private val now: () -> Long = System::currentTimeMillis,
) : LayerCache {
    override suspend fun read(id: String): LayerResponse? {
        val row = dao.find(id) ?: return null
        return LayerResponse(id = row.id, name = row.name, geoJson = row.geoJson)
    }

    override suspend fun write(layer: LayerResponse) {
        dao.upsert(
            LayerCacheEntity(
                id = layer.id,
                name = layer.name,
                geoJson = layer.geoJson,
                cachedAtEpochMs = now(),
            ),
        )
    }
}

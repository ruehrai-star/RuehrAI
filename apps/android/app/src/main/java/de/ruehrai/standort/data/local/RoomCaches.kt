package de.ruehrai.standort.data.local

import android.content.Context
import androidx.room.Room
import de.ruehrai.api.infrastructure.Serializer
import de.ruehrai.api.models.FeatureCollection
import de.ruehrai.api.models.SearchResponse
import de.ruehrai.standort.data.cache.LayerCache
import de.ruehrai.standort.data.cache.SearchCache

fun createAppDatabase(context: Context): AppDatabase =
    Room.databaseBuilder(context, AppDatabase::class.java, "standort-cache.db")
        .fallbackToDestructiveMigration(dropAllTables = true)
        .build()

class RoomSearchCache(
    private val dao: SearchCacheDao,
    private val now: () -> Long = System::currentTimeMillis,
) : SearchCache {
    private val adapter = Serializer.moshi.adapter(SearchResponse::class.java)

    override suspend fun read(key: String): SearchResponse? {
        val row = dao.find(key) ?: return null
        return adapter.fromJson(row.payloadJson)
    }

    override suspend fun write(key: String, response: SearchResponse) {
        dao.upsert(
            SearchCacheEntity(
                query = key,
                payloadJson = adapter.toJson(response),
                cachedAtEpochMs = now(),
            ),
        )
    }
}

class RoomLayerCache(
    private val dao: LayerCacheDao,
    private val now: () -> Long = System::currentTimeMillis,
) : LayerCache {
    private val adapter = Serializer.moshi.adapter(FeatureCollection::class.java)

    override suspend fun read(id: String): FeatureCollection? {
        val row = dao.find(id) ?: return null
        return adapter.fromJson(row.geoJson)
    }

    override suspend fun write(id: String, layer: FeatureCollection) {
        dao.upsert(
            LayerCacheEntity(
                id = id,
                name = layer.name ?: id,
                geoJson = adapter.toJson(layer),
                cachedAtEpochMs = now(),
            ),
        )
    }
}

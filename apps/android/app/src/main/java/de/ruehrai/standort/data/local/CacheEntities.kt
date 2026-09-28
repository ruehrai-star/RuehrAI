package de.ruehrai.standort.data.local

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase

@Entity(tableName = "search_cache")
data class SearchCacheEntity(
    @PrimaryKey val query: String,
    val payloadJson: String,
    val cachedAtEpochMs: Long,
)

@Entity(tableName = "layer_cache")
data class LayerCacheEntity(
    @PrimaryKey val id: String,
    val name: String,
    val geoJson: String,
    val cachedAtEpochMs: Long,
)

@Dao
interface SearchCacheDao {
    @Query("SELECT * FROM search_cache WHERE query = :query LIMIT 1")
    suspend fun find(query: String): SearchCacheEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: SearchCacheEntity)
}

@Dao
interface LayerCacheDao {
    @Query("SELECT * FROM layer_cache WHERE id = :id LIMIT 1")
    suspend fun find(id: String): LayerCacheEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: LayerCacheEntity)
}

@Database(
    entities = [SearchCacheEntity::class, LayerCacheEntity::class],
    version = 1,
    exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun searchCacheDao(): SearchCacheDao

    abstract fun layerCacheDao(): LayerCacheDao
}

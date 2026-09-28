package de.ruehrai.standort.data

import de.ruehrai.api.infrastructure.Serializer
import de.ruehrai.api.models.Credentials
import de.ruehrai.api.models.FeatureCollection
import de.ruehrai.api.models.SearchResponse
import de.ruehrai.api.models.TokenResponse
import org.junit.Assert.assertEquals
import org.junit.Test

class GeneratedContractJsonTest {
    private val moshi = Serializer.moshi

    @Test
    fun credentialsAndTokenMatchOpenApiNames() {
        val credentials = moshi.adapter(Credentials::class.java).fromJson(
            """{"email":"dev@ruehrai.local","password":"dev-password"}""",
        )
        assertEquals("dev@ruehrai.local", credentials?.email)

        val token = moshi.adapter(TokenResponse::class.java).fromJson(
            """{"accessToken":"abc","tokenType":"Bearer","expiresIn":28800}""",
        )
        assertEquals("abc", token?.accessToken)
        assertEquals(TokenResponse.TokenType.BEARER, token?.tokenType)
        assertEquals(28800, token?.expiresIn)
    }

    @Test
    fun searchHitUsesGrainGeoKeyLonLat() {
        val response = moshi.adapter(SearchResponse::class.java).fromJson(
            """
            {"hits":[{"id":"ags:09162000","label":"München","grain":"ags","geoKey":"09162000","lon":11.5755,"lat":48.1374}]}
            """.trimIndent(),
        )
        val hit = response!!.hits.single()
        assertEquals("09162000", hit.geoKey)
        assertEquals(11.5755, hit.lon!!, 0.0001)
        assertEquals(48.1374, hit.lat!!, 0.0001)
    }

    @Test
    fun featureCollectionDecodesSeedShape() {
        val collection = moshi.adapter(FeatureCollection::class.java).fromJson(
            """
            {
              "type": "FeatureCollection",
              "name": "Demo-Gemeinden",
              "features": [
                {
                  "type": "Feature",
                  "id": "ags:11000000",
                  "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[11.36, 48.06], [11.72, 48.06], [11.72, 48.25], [11.36, 48.25], [11.36, 48.06]]]
                  },
                  "properties": { "label": "Berlin", "grain": "ags", "stub": true }
                }
              ]
            }
            """.trimIndent(),
        )
        assertEquals("Demo-Gemeinden", collection?.name)
        assertEquals(1, collection?.features?.size)
    }
}

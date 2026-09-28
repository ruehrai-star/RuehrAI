package de.ruehrai.standort.ui.map

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import de.ruehrai.standort.data.geo.positions
import de.ruehrai.standort.data.geo.selectionGeoJson
import de.ruehrai.standort.data.geo.toGeoJson
import de.ruehrai.api.models.FeatureCollection
import de.ruehrai.api.models.SearchHit
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style

private val GermanyCenter = LatLng(51.2, 10.4)
private const val OverviewZoom = 5.2
private const val SelectionZoom = 11.5

@Composable
fun StandortMap(
    layer: FeatureCollection?,
    selection: SearchHit?,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val mapView = remember {
        MapView(context).apply { onCreate(null) }
    }
    var map by remember { mutableStateOf<MapLibreMap?>(null) }
    var styleReady by remember { mutableStateOf(false) }
    val geoJson = remember(layer) { layer?.toGeoJson() }

    DisposableEffect(lifecycle, mapView) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> mapView.onStart()
                Lifecycle.Event.ON_RESUME -> mapView.onResume()
                Lifecycle.Event.ON_PAUSE -> mapView.onPause()
                Lifecycle.Event.ON_STOP -> mapView.onStop()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
            mapView.onStart()
        }
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
            mapView.onResume()
        }
        onDispose {
            lifecycle.removeObserver(observer)
            mapView.onPause()
            mapView.onStop()
            mapView.onDestroy()
        }
    }

    AndroidView(
        factory = {
            mapView.getMapAsync { readyMap ->
                map = readyMap
                readyMap.cameraPosition = CameraPosition.Builder()
                    .target(GermanyCenter)
                    .zoom(OverviewZoom)
                    .build()
                readyMap.setStyle(Style.Builder().fromUri(DEMO_STYLE_URI)) {
                    styleReady = true
                }
            }
            mapView
        },
        modifier = modifier,
    )

    LaunchedEffect(styleReady, geoJson, selection?.id) {
        val readyMap = map ?: return@LaunchedEffect
        val style = readyMap.style ?: return@LaunchedEffect
        if (!styleReady) return@LaunchedEffect
        if (geoJson != null) {
            style.upsertAreas(geoJson)
        }
        val hit = selection
        val selectionJson = hit?.let(::selectionGeoJson)
        if (selectionJson != null && hit.lon != null && hit.lat != null) {
            style.upsertSelection(selectionJson)
            readyMap.easeCamera(
                CameraUpdateFactory.newLatLngZoom(LatLng(hit.lat, hit.lon), SelectionZoom),
                600,
            )
        } else if (layer != null) {
            fit(readyMap, layer.positions())
        }
    }
}

private fun fit(map: MapLibreMap, positions: List<Pair<Double, Double>>) {
    if (positions.isEmpty()) return
    val lats = positions.map { it.second }
    val lons = positions.map { it.first }
    val latSpan = (lats.max() - lats.min())
    val lonSpan = (lons.max() - lons.min())
    if (latSpan < 0.05 && lonSpan < 0.05) {
        map.easeCamera(
            CameraUpdateFactory.newLatLngZoom(LatLng(lats.average(), lons.average()), SelectionZoom),
            600,
        )
        return
    }
    val bounds = LatLngBounds.Builder()
        .include(LatLng(lats.min(), lons.min()))
        .include(LatLng(lats.max(), lons.max()))
        .build()
    map.easeCamera(CameraUpdateFactory.newLatLngBounds(bounds, 72), 600)
}

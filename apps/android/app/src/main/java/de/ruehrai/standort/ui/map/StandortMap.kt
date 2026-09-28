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
import de.ruehrai.standort.data.geo.selectionGeoJson
import de.ruehrai.standort.data.model.SearchHit
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style

private val RuhrCenter = LatLng(51.45, 7.05)
private const val OverviewZoom = 8.2
private const val SelectionZoom = 11.5

@Composable
fun StandortMap(
    geoJson: String?,
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
                    .target(RuhrCenter)
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

    LaunchedEffect(styleReady, geoJson) {
        val style = map?.style ?: return@LaunchedEffect
        if (styleReady && geoJson != null) {
            style.upsertAreas(geoJson)
        }
    }

    LaunchedEffect(styleReady, selection?.id) {
        val readyMap = map ?: return@LaunchedEffect
        val style = readyMap.style ?: return@LaunchedEffect
        val hit = selection ?: return@LaunchedEffect
        if (!styleReady) return@LaunchedEffect
        style.upsertSelection(selectionGeoJson(hit))
        readyMap.easeCamera(
            CameraUpdateFactory.newLatLngZoom(LatLng(hit.latitude, hit.longitude), SelectionZoom),
            600,
        )
    }
}

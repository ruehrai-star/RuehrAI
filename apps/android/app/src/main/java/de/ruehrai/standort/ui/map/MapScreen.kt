package de.ruehrai.standort.ui.map

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import de.ruehrai.standort.R
import de.ruehrai.standort.data.geo.featureCount
import de.ruehrai.standort.data.model.LayerResponse
import de.ruehrai.standort.data.model.SearchHit

@Composable
fun MapScreen(
    layer: LayerResponse?,
    layerFailed: Boolean,
    selection: SearchHit?,
    modifier: Modifier = Modifier,
) {
    val mapDescription = stringResource(R.string.map_content_description)
    Box(
        modifier = modifier
            .fillMaxSize()
            .semantics { contentDescription = mapDescription },
    ) {
        when {
            layerFailed -> {
                Text(
                    text = stringResource(R.string.map_layer_error),
                    modifier = Modifier
                        .align(Alignment.Center)
                        .padding(24.dp),
                    color = MaterialTheme.colorScheme.error,
                )
            }
            layer == null -> {
                CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
            }
            else -> {
                StandortMap(
                    geoJson = layer.geoJson,
                    selection = selection,
                    modifier = Modifier.fillMaxSize(),
                )
                MapCaption(
                    layer = layer,
                    selection = selection,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(12.dp),
                )
            }
        }
    }
}

@Composable
private fun MapCaption(
    layer: LayerResponse,
    selection: SearchHit?,
    modifier: Modifier = Modifier,
) {
    val count = runCatching { featureCount(layer.geoJson) }.getOrDefault(0)
    val text = if (selection == null) {
        pluralStringResource(R.plurals.map_caption, count, layer.name, count)
    } else {
        stringResource(R.string.map_caption_selection, selection.label)
    }
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
        tonalElevation = 2.dp,
    ) {
        Text(
            text = text,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

package de.ruehrai.standort.ui.map

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
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
import de.ruehrai.api.models.FeatureCollection
import de.ruehrai.api.models.SearchHit
import de.ruehrai.standort.R
import de.ruehrai.standort.data.model.DemoLayers

@Composable
fun MapScreen(
    layerId: String,
    layer: FeatureCollection?,
    layerFailed: Boolean,
    selection: SearchHit?,
    onLayerSelected: (String) -> Unit,
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
                    layer = layer,
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
        LayerPicker(
            selectedId = layerId,
            onLayerSelected = onLayerSelected,
            modifier = Modifier
                .align(Alignment.TopCenter)
                .padding(8.dp),
        )
    }
}

@Composable
private fun LayerPicker(
    selectedId: String,
    onLayerSelected: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
    ) {
        Row(
            modifier = Modifier
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 8.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            DemoLayers.ids.forEach { id ->
                FilterChip(
                    selected = id == selectedId,
                    onClick = { onLayerSelected(id) },
                    label = { Text(id) },
                )
            }
        }
    }
}

@Composable
private fun MapCaption(
    layer: FeatureCollection,
    selection: SearchHit?,
    modifier: Modifier = Modifier,
) {
    val count = layer.features.size
    val name = layer.name ?: stringResource(R.string.map_unnamed_layer)
    val text = if (selection == null) {
        pluralStringResource(R.plurals.map_caption, count, name, count)
    } else if (selection.lon == null || selection.lat == null) {
        stringResource(R.string.map_caption_selection_no_coords, selection.label)
    } else {
        stringResource(R.string.map_caption_selection, selection.label)
    }
    Column(modifier = modifier.fillMaxWidth()) {
        Surface(
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
}

package de.ruehrai.standort.ui.search

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import de.ruehrai.standort.R
import de.ruehrai.standort.data.model.SearchHit
import de.ruehrai.standort.data.model.SearchKind

@Composable
fun SearchScreen(
    query: String,
    results: List<SearchHit>,
    searching: Boolean,
    failed: Boolean,
    onQueryChange: (String) -> Unit,
    onResultClick: (SearchHit) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        OutlinedTextField(
            value = query,
            onValueChange = onQueryChange,
            modifier = Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.search_label)) },
            placeholder = { Text(stringResource(R.string.search_placeholder)) },
            singleLine = true,
        )
        Spacer(Modifier.height(12.dp))
        when {
            searching -> {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center,
                ) {
                    CircularProgressIndicator()
                }
            }
            failed -> {
                Text(
                    text = stringResource(R.string.search_error),
                    color = MaterialTheme.colorScheme.error,
                )
            }
            query.isBlank() -> {
                Text(
                    text = stringResource(R.string.search_prompt),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            results.isEmpty() -> {
                Text(
                    text = stringResource(R.string.search_empty),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            else -> {
                LazyColumn(
                    contentPadding = PaddingValues(bottom = 24.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(results, key = { it.id }) { hit ->
                        SearchResultRow(hit = hit, onClick = { onResultClick(hit) })
                        HorizontalDivider()
                    }
                }
            }
        }
    }
}

@Composable
private fun SearchResultRow(
    hit: SearchHit,
    onClick: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            KindBadge(kind = hit.kind)
            Spacer(Modifier.padding(horizontal = 6.dp))
            Text(text = hit.label, style = MaterialTheme.typography.bodyLarge)
        }
        Spacer(Modifier.height(4.dp))
        Text(
            text = hit.subtitle,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
        )
    }
}

@Composable
private fun KindBadge(kind: SearchKind) {
    val label = when (kind) {
        SearchKind.ADDRESS -> stringResource(R.string.kind_address)
        SearchKind.AGS -> stringResource(R.string.kind_ags)
        SearchKind.PLZ -> stringResource(R.string.kind_plz)
    }
    Surface(
        color = MaterialTheme.colorScheme.secondaryContainer,
        shape = RoundedCornerShape(6.dp),
    ) {
        Text(
            text = label,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSecondaryContainer,
        )
    }
}

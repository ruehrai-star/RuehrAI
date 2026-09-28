package de.ruehrai.standort.ui.shell

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import de.ruehrai.standort.R
import de.ruehrai.standort.ui.map.MapScreen
import de.ruehrai.standort.ui.search.SearchScreen

private enum class ShellTab {
    Map,
    Search,
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShellScreen(
    userEmail: String?,
    state: ShellUiState,
    onQueryChange: (String) -> Unit,
    onSearchTypeChange: (de.ruehrai.api.models.SearchType?) -> Unit,
    onLayerSelected: (String) -> Unit,
    onSelect: (de.ruehrai.api.models.SearchHit) -> Unit,
    onLogout: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var tab by rememberSaveable { mutableStateOf(ShellTab.Map) }
    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(stringResource(R.string.app_name))
                        if (userEmail != null) {
                            Text(
                                text = userEmail,
                                style = MaterialTheme.typography.labelMedium,
                            )
                        }
                    }
                },
                actions = {
                    TextButton(onClick = onLogout) {
                        Text(stringResource(R.string.logout))
                    }
                },
            )
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = tab == ShellTab.Map,
                    onClick = { tab = ShellTab.Map },
                    icon = { Icon(Icons.Filled.Place, contentDescription = null) },
                    label = { Text(stringResource(R.string.tab_map)) },
                )
                NavigationBarItem(
                    selected = tab == ShellTab.Search,
                    onClick = { tab = ShellTab.Search },
                    icon = { Icon(Icons.Filled.Search, contentDescription = null) },
                    label = { Text(stringResource(R.string.tab_search)) },
                )
            }
        },
    ) { padding ->
        when (tab) {
            ShellTab.Map -> MapScreen(
                layerId = state.layerId,
                layer = state.layer,
                layerFailed = state.layerFailed,
                selection = state.selection,
                onLayerSelected = onLayerSelected,
                modifier = Modifier.padding(padding),
            )
            ShellTab.Search -> SearchScreen(
                query = state.query,
                searchType = state.searchType,
                results = state.results,
                searching = state.searching,
                failed = state.searchFailed,
                onQueryChange = onQueryChange,
                onSearchTypeChange = onSearchTypeChange,
                onResultClick = { hit ->
                    onSelect(hit)
                    tab = ShellTab.Map
                },
                modifier = Modifier.padding(padding),
            )
        }
    }
}

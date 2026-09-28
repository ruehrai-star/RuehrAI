package de.ruehrai.standort.ui.shell

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import de.ruehrai.api.models.FeatureCollection
import de.ruehrai.api.models.SearchHit
import de.ruehrai.api.models.SearchType
import de.ruehrai.standort.data.model.DemoLayers
import de.ruehrai.standort.data.model.SearchQuery
import de.ruehrai.standort.data.repo.StandortRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class ShellUiState(
    val query: String = "",
    val searchType: SearchType? = null,
    val results: List<SearchHit> = emptyList(),
    val searching: Boolean = false,
    val searchFailed: Boolean = false,
    val layerId: String = DemoLayers.GEMEINDEN,
    val layer: FeatureCollection? = null,
    val layerFailed: Boolean = false,
    val selection: SearchHit? = null,
)

class ShellViewModel(
    private val repository: StandortRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(ShellUiState())
    val state: StateFlow<ShellUiState> = _state.asStateFlow()
    private var searchJob: Job? = null

    init {
        loadLayer(DemoLayers.GEMEINDEN)
    }

    fun onQueryChange(value: String) {
        _state.value = _state.value.copy(query = value, searchFailed = false)
        scheduleSearch()
    }

    fun onSearchTypeChange(type: SearchType?) {
        _state.value = _state.value.copy(searchType = type, searchFailed = false)
        scheduleSearch()
    }

    fun onLayerSelected(id: String) {
        if (_state.value.layerId == id && _state.value.layer != null) return
        _state.value = _state.value.copy(layerId = id, layer = null, layerFailed = false)
        loadLayer(id)
    }

    fun select(hit: SearchHit) {
        _state.value = _state.value.copy(selection = hit)
    }

    private fun loadLayer(id: String) {
        viewModelScope.launch {
            try {
                val layer = repository.layer(id)
                if (_state.value.layerId == id) {
                    _state.value = _state.value.copy(layer = layer, layerFailed = false)
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                if (_state.value.layerId == id) {
                    _state.value = _state.value.copy(layerFailed = true)
                }
            }
        }
    }

    private fun scheduleSearch() {
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(SEARCH_DEBOUNCE_MS)
            val current = _state.value
            val trimmed = current.query.trim()
            if (trimmed.isEmpty()) {
                _state.value = current.copy(results = emptyList(), searching = false, searchFailed = false)
                return@launch
            }
            _state.value = current.copy(searching = true, searchFailed = false)
            try {
                val response = repository.search(SearchQuery(q = trimmed, type = current.searchType))
                _state.value = _state.value.copy(results = response.hits, searching = false)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                _state.value = _state.value.copy(results = emptyList(), searching = false, searchFailed = true)
            }
        }
    }

    companion object {
        private const val SEARCH_DEBOUNCE_MS = 250L

        fun factory(repository: StandortRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    ShellViewModel(repository) as T
            }
    }
}

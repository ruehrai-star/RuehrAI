package de.ruehrai.standort.ui.shell

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import de.ruehrai.standort.data.model.LayerResponse
import de.ruehrai.standort.data.model.SearchHit
import de.ruehrai.standort.data.model.StandortEndpoints
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
    val results: List<SearchHit> = emptyList(),
    val searching: Boolean = false,
    val searchFailed: Boolean = false,
    val layer: LayerResponse? = null,
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
        viewModelScope.launch {
            try {
                val layer = repository.layer(StandortEndpoints.SAMPLE_LAYER_ID)
                _state.value = _state.value.copy(layer = layer, layerFailed = false)
            } catch (_: Exception) {
                _state.value = _state.value.copy(layerFailed = true)
            }
        }
    }

    fun onQueryChange(value: String) {
        _state.value = _state.value.copy(query = value, searchFailed = false)
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(SEARCH_DEBOUNCE_MS)
            val trimmed = _state.value.query.trim()
            if (trimmed.isEmpty()) {
                _state.value = _state.value.copy(results = emptyList(), searching = false, searchFailed = false)
                return@launch
            }
            _state.value = _state.value.copy(searching = true, searchFailed = false)
            try {
                val response = repository.search(trimmed)
                _state.value = _state.value.copy(results = response.results, searching = false)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                _state.value = _state.value.copy(results = emptyList(), searching = false, searchFailed = true)
            }
        }
    }

    fun select(hit: SearchHit) {
        _state.value = _state.value.copy(selection = hit)
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

package de.ruehrai.standort.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import de.ruehrai.api.infrastructure.ApiClient
import de.ruehrai.api.models.TokenResponse
import de.ruehrai.standort.data.model.ApiError
import de.ruehrai.standort.data.model.StandortApiException
import de.ruehrai.standort.data.repo.StandortRepository
import de.ruehrai.standort.data.settings.ApiSettings
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class SessionUiState(
    val email: String = "",
    val password: String = "",
    val baseUrl: String = "",
    val useMock: Boolean = false,
    val submitting: Boolean = false,
    val error: ApiError? = null,
    val healthOk: Boolean? = null,
    val session: TokenResponse? = null,
    val userEmail: String? = null,
)

class SessionViewModel(
    private val repository: StandortRepository,
    private val settings: ApiSettings,
) : ViewModel() {
    private val _state = MutableStateFlow(
        SessionUiState(
            baseUrl = settings.baseUrl,
            useMock = settings.useMock,
        ),
    )
    val state: StateFlow<SessionUiState> = _state.asStateFlow()

    init {
        refreshHealth()
    }

    fun onEmailChange(value: String) {
        _state.value = _state.value.copy(email = value, error = null)
    }

    fun onPasswordChange(value: String) {
        _state.value = _state.value.copy(password = value, error = null)
    }

    fun onBaseUrlChange(value: String) {
        settings.baseUrl = value
        _state.value = _state.value.copy(baseUrl = value, error = null, healthOk = null)
        refreshHealth()
    }

    fun onUseMockChange(value: Boolean) {
        settings.useMock = value
        _state.value = _state.value.copy(useMock = value, error = null, healthOk = if (value) null else _state.value.healthOk)
        refreshHealth()
    }

    fun login() = authenticate(register = false)

    fun register() = authenticate(register = true)

    fun logout() {
        ApiClient.accessToken = null
        _state.value = _state.value.copy(
            session = null,
            userEmail = null,
            password = "",
            submitting = false,
            error = null,
        )
    }

    private fun authenticate(register: Boolean) {
        val current = _state.value
        if (current.submitting) return
        _state.value = current.copy(submitting = true, error = null)
        viewModelScope.launch {
            try {
                val session = if (register) {
                    repository.register(current.email, current.password)
                } else {
                    repository.login(current.email, current.password)
                }
                val user = repository.currentUser()
                _state.value = _state.value.copy(
                    submitting = false,
                    session = session,
                    userEmail = user.email,
                    password = "",
                )
            } catch (error: StandortApiException) {
                ApiClient.accessToken = null
                _state.value = _state.value.copy(submitting = false, error = error.code)
            } catch (_: Exception) {
                ApiClient.accessToken = null
                _state.value = _state.value.copy(submitting = false, error = ApiError.UNKNOWN)
            }
        }
    }

    private fun refreshHealth() {
        if (_state.value.useMock) return
        viewModelScope.launch {
            val ok = runCatching { repository.health().status.name == "OK" }.getOrDefault(false)
            if (!_state.value.useMock) {
                _state.value = _state.value.copy(healthOk = ok)
            }
        }
    }

    companion object {
        fun factory(repository: StandortRepository, settings: ApiSettings): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    SessionViewModel(repository, settings) as T
            }
    }
}

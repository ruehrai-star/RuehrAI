package de.ruehrai.standort.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import de.ruehrai.standort.data.model.ApiError
import de.ruehrai.standort.data.model.AuthSession
import de.ruehrai.standort.data.model.StandortApiException
import de.ruehrai.standort.data.repo.StandortRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class SessionUiState(
    val email: String = "",
    val password: String = "",
    val submitting: Boolean = false,
    val error: ApiError? = null,
    val session: AuthSession? = null,
)

class SessionViewModel(
    private val repository: StandortRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(SessionUiState())
    val state: StateFlow<SessionUiState> = _state.asStateFlow()

    fun onEmailChange(value: String) {
        _state.value = _state.value.copy(email = value, error = null)
    }

    fun onPasswordChange(value: String) {
        _state.value = _state.value.copy(password = value, error = null)
    }

    fun login() {
        val current = _state.value
        if (current.submitting) return
        _state.value = current.copy(submitting = true, error = null)
        viewModelScope.launch {
            try {
                val session = repository.login(current.email, current.password)
                _state.value = _state.value.copy(submitting = false, session = session, password = "")
            } catch (error: StandortApiException) {
                _state.value = _state.value.copy(submitting = false, error = error.code)
            } catch (_: Exception) {
                _state.value = _state.value.copy(submitting = false, error = ApiError.INVALID_CREDENTIALS)
            }
        }
    }

    fun logout() {
        _state.value = SessionUiState()
    }

    companion object {
        fun factory(repository: StandortRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    SessionViewModel(repository) as T
            }
    }
}

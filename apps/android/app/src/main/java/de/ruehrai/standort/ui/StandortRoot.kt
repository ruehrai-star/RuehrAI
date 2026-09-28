package de.ruehrai.standort.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.viewmodel.compose.viewModel
import de.ruehrai.standort.data.repo.StandortRepository
import de.ruehrai.standort.ui.auth.LoginScreen
import de.ruehrai.standort.ui.auth.SessionViewModel
import de.ruehrai.standort.ui.shell.ShellScreen
import de.ruehrai.standort.ui.shell.ShellViewModel

@Composable
fun StandortRoot(repository: StandortRepository) {
    val sessionViewModel: SessionViewModel = viewModel(factory = SessionViewModel.factory(repository))
    val sessionState by sessionViewModel.state.collectAsState()
    val session = sessionState.session
    if (session == null) {
        LoginScreen(
            state = sessionState,
            onEmailChange = sessionViewModel::onEmailChange,
            onPasswordChange = sessionViewModel::onPasswordChange,
            onSubmit = sessionViewModel::login,
        )
    } else {
        val shellViewModel: ShellViewModel = viewModel(
            key = session.accessToken,
            factory = ShellViewModel.factory(repository),
        )
        val shellState by shellViewModel.state.collectAsState()
        ShellScreen(
            state = shellState,
            onQueryChange = shellViewModel::onQueryChange,
            onSelect = shellViewModel::select,
            onLogout = sessionViewModel::logout,
        )
    }
}

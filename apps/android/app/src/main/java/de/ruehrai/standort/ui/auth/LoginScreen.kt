package de.ruehrai.standort.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import de.ruehrai.standort.R
import de.ruehrai.standort.data.model.ApiError

@Composable
fun LoginScreen(
    state: SessionUiState,
    onEmailChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onBaseUrlChange: (String) -> Unit,
    onUseMockChange: (Boolean) -> Unit,
    onLogin: () -> Unit,
    onRegister: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Scaffold(modifier = modifier) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 32.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = stringResource(R.string.login_title),
                style = MaterialTheme.typography.headlineMedium,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = stringResource(R.string.login_subtitle),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.75f),
            )
            Spacer(Modifier.height(20.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(stringResource(R.string.login_mock_switch))
                    Text(
                        text = if (state.useMock) {
                            stringResource(R.string.login_mode_mock)
                        } else {
                            stringResource(R.string.login_mode_live)
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                    )
                }
                Switch(checked = state.useMock, onCheckedChange = onUseMockChange)
            }
            if (!state.useMock) {
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = state.baseUrl,
                    onValueChange = onBaseUrlChange,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text(stringResource(R.string.login_base_url)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = healthLabel(state.healthOk),
                    style = MaterialTheme.typography.bodySmall,
                    color = if (state.healthOk == false) {
                        MaterialTheme.colorScheme.error
                    } else {
                        MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
                    },
                )
            }
            Spacer(Modifier.height(16.dp))
            OutlinedTextField(
                value = state.email,
                onValueChange = onEmailChange,
                modifier = Modifier.fillMaxWidth(),
                label = { Text(stringResource(R.string.login_email)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Email,
                    imeAction = ImeAction.Next,
                ),
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = state.password,
                onValueChange = onPasswordChange,
                modifier = Modifier.fillMaxWidth(),
                label = { Text(stringResource(R.string.login_password)) },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Done,
                ),
                keyboardActions = KeyboardActions(onDone = { onLogin() }),
            )
            state.error?.let { error ->
                Spacer(Modifier.height(12.dp))
                Text(
                    text = stringResource(errorMessage(error)),
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            Spacer(Modifier.height(20.dp))
            Button(
                onClick = onLogin,
                enabled = canSubmit(state),
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (state.submitting) {
                    CircularProgressIndicator(modifier = Modifier.height(18.dp), strokeWidth = 2.dp)
                } else {
                    Text(stringResource(R.string.login_submit))
                }
            }
            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = onRegister,
                enabled = canSubmit(state),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.login_register))
            }
            Spacer(Modifier.height(16.dp))
            Text(
                text = stringResource(R.string.login_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
            )
        }
    }
}

private fun canSubmit(state: SessionUiState): Boolean =
    !state.submitting && state.email.isNotBlank() && state.password.isNotBlank()

@Composable
private fun healthLabel(healthOk: Boolean?): String = when (healthOk) {
    true -> stringResource(R.string.login_health_ok)
    false -> stringResource(R.string.login_health_down)
    null -> stringResource(R.string.login_health_checking)
}

private fun errorMessage(error: ApiError): Int = when (error) {
    ApiError.INVALID_CREDENTIALS -> R.string.login_error_credentials
    ApiError.CONFLICT -> R.string.login_error_conflict
    ApiError.NETWORK -> R.string.login_error_network
    ApiError.BAD_REQUEST -> R.string.login_error_bad_request
    ApiError.UNAUTHORIZED, ApiError.NOT_FOUND, ApiError.UNKNOWN -> R.string.login_error_unknown
}

package de.ruehrai.standort

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import de.ruehrai.standort.ui.StandortRoot
import de.ruehrai.standort.ui.theme.StandortTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val container = (application as StandortApp).container
        setContent {
            StandortTheme {
                StandortRoot(
                    repository = container.repository,
                    settings = container.settings,
                )
            }
        }
    }
}

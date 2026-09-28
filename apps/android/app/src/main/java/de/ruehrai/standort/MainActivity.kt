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
        val repository = (application as StandortApp).container.repository
        setContent {
            StandortTheme {
                StandortRoot(repository)
            }
        }
    }
}

package de.ruehrai.standort.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Slate = Color(0xFF1F4E5F)
private val Ink = Color(0xFF1C2426)
private val Paper = Color(0xFFF7F4EF)
private val Card = Color(0xFFFFFCF8)
private val Copper = Color(0xFFC4622D)

private val StandortColors = lightColorScheme(
    primary = Slate,
    onPrimary = Color(0xFFF4F1EC),
    secondary = Copper,
    onSecondary = Color(0xFFFFF8F4),
    secondaryContainer = Color(0xFFF3D7C8),
    onSecondaryContainer = Color(0xFF4A2412),
    background = Paper,
    onBackground = Ink,
    surface = Card,
    onSurface = Ink,
    error = Color(0xFF9B2C2C),
)

@Composable
fun StandortTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = StandortColors,
        content = content,
    )
}

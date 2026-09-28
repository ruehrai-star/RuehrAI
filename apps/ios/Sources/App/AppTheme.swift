import SwiftUI
import UIKit

enum AppTheme {
    static let accentRed = 0.106
    static let accentGreen = 0.310
    static let accentBlue = 0.447

    static let accent = Color(red: accentRed, green: accentGreen, blue: accentBlue)
    static let accentUIColor = UIColor(red: accentRed, green: accentGreen, blue: accentBlue, alpha: 1)
    static let fillUIColor = UIColor(red: accentRed, green: accentGreen, blue: accentBlue, alpha: 0.33)
}

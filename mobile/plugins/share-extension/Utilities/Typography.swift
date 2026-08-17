/**
 * Typography - Custom font definitions for Share Extension
 *
 * Fonts must be:
 * 1. Added to the target's Copy Bundle Resources build phase
 * 2. Listed in Info.plist under UIAppFonts
 *
 * Font file names (from expo-google-fonts):
 * - PlayfairDisplay_700Bold.ttf
 * - OpenSans_400Regular.ttf
 * - OpenSans_600SemiBold.ttf
 * - Oswald_500Medium.ttf
 *
 * IMPORTANT: The font name used in .custom() must match the PostScript name
 * embedded in the font file, NOT the filename. Google Fonts typically use
 * underscores (PlayfairDisplay_700Bold) in the PostScript name.
 */

import SwiftUI

enum Typography {
    // MARK: - Font Names (PostScript names from Google Fonts)

    private static let playfairBold = "PlayfairDisplay-Bold"
    private static let openSansRegular = "OpenSans-Regular"
    private static let openSansSemiBold = "OpenSans-SemiBold"
    private static let oswaldMedium = "Oswald-Medium"

    // MARK: - Headers (Playfair Display Bold)

    /// Main header font - Playfair Display Bold
    /// Used for: "Save Place" title, major headings
    static func header(_ size: CGFloat) -> Font {
        .custom(playfairBold, size: size)
    }

    // MARK: - Section Labels (Oswald Medium)

    /// Section label font - Oswald Medium, uppercase
    /// Used for: "CONFIRM LOCATION", "SAVE TO TRIP", "CATEGORY"
    static func sectionLabel() -> Font {
        .custom(oswaldMedium, size: 12)
    }

    // MARK: - Body Text (Open Sans)

    /// Regular body text - Open Sans Regular
    /// Used for: Input fields, descriptions, general text
    static func body(_ size: CGFloat = 16) -> Font {
        .custom(openSansRegular, size: size)
    }

    /// Semi-bold body text - Open Sans SemiBold
    /// Used for: Button labels, emphasized text, selected items
    static func semibold(_ size: CGFloat = 16) -> Font {
        .custom(openSansSemiBold, size: size)
    }

    // MARK: - Places Autocomplete

    /// Main text in autocomplete predictions
    static func predictionMain() -> Font {
        .custom(openSansSemiBold, size: 15)
    }

    /// Secondary text in autocomplete predictions
    static func predictionSecondary() -> Font {
        .custom(openSansRegular, size: 13)
    }
}

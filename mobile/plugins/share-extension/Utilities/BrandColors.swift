/**
 * BrandColors - Atlasi brand color palette for SwiftUI
 *
 * These colors match the React Native color constants from colors.ts
 */

import SwiftUI

enum BrandColors {
    // MARK: - Primary Brand Colors

    /// Dark navy used for text, headers, and primary UI elements
    static let midnightNavy = Color(red: 23/255, green: 42/255, blue: 58/255)

    /// Warm cream background color
    static let warmCream = Color(red: 253/255, green: 246/255, blue: 237/255)

    /// Golden accent for CTAs and highlights
    static let sunsetGold = Color(red: 244/255, green: 194/255, blue: 78/255)

    /// Brick red accent color
    static let adobeBrick = Color(red: 193/255, green: 84/255, blue: 62/255)

    /// Light blue accent
    static let lakeBlue = Color(red: 160/255, green: 205/255, blue: 235/255)

    /// Green accent for secondary elements
    static let mossGreen = Color(red: 84/255, green: 122/255, blue: 95/255)

    // MARK: - Muted Earth Tones (New)
    static let latteGold = Color(red: 212/255, green: 163/255, blue: 115/255)
    static let slateBlue = Color(red: 141/255, green: 153/255, blue: 174/255)
    static let oliveGreen = Color(red: 107/255, green: 112/255, blue: 92/255)

    // MARK: - Secondary Colors

    /// Card background color
    static let paperBeige = Color(red: 245/255, green: 236/255, blue: 224/255)

    /// Secondary text color
    static let stormGray = Color(red: 102/255, green: 109/255, blue: 122/255)

    /// Pure white for text on dark backgrounds
    static let cloudWhite = Color.white

    // MARK: - Entry Type Colors

    /// Place entry type color (adobeBrick) - Matches React Native
    static let entryPlace = adobeBrick

    /// Food entry type color (latteGold) - Earthy
    static let entryFood = latteGold

    /// Stay entry type color (slateBlue) - Muted
    static let entryStay = slateBlue

    /// Experience entry type color (oliveGreen) - Natural
    static let entryExperience = oliveGreen

    // MARK: - UIKit Colors (for ShareViewController compatibility)

    static let midnightNavyUI = UIColor(red: 23/255, green: 42/255, blue: 58/255, alpha: 1.0)
    static let warmCreamUI = UIColor(red: 253/255, green: 246/255, blue: 237/255, alpha: 1.0)
    static let sunsetGoldUI = UIColor(red: 244/255, green: 194/255, blue: 78/255, alpha: 1.0)
    static let adobeBrickUI = UIColor(red: 193/255, green: 84/255, blue: 62/255, alpha: 1.0)
    static let mossGreenUI = UIColor(red: 84/255, green: 122/255, blue: 95/255, alpha: 1.0)
    static let latteGoldUI = UIColor(red: 212/255, green: 163/255, blue: 115/255, alpha: 1.0)
    static let slateBlueUI = UIColor(red: 141/255, green: 153/255, blue: 174/255, alpha: 1.0)
    static let oliveGreenUI = UIColor(red: 107/255, green: 112/255, blue: 92/255, alpha: 1.0)
    static let paperBeigeUI = UIColor(red: 245/255, green: 236/255, blue: 224/255, alpha: 1.0)
    static let stormGrayUI = UIColor(red: 102/255, green: 109/255, blue: 122/255, alpha: 1.0)
}

// MARK: - Opacity Helpers

extension BrandColors {
    /// Midnight navy with custom opacity
    static func midnightNavy(opacity: Double) -> Color {
        midnightNavy.opacity(opacity)
    }

    /// Storm gray with custom opacity
    static func stormGray(opacity: Double) -> Color {
        stormGray.opacity(opacity)
    }
}

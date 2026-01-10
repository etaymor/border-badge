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

    // MARK: - Secondary Colors

    /// Card background color
    static let paperBeige = Color(red: 245/255, green: 236/255, blue: 224/255)

    /// Secondary text color
    static let stormGray = Color(red: 102/255, green: 109/255, blue: 122/255)

    /// Pure white for text on dark backgrounds
    static let cloudWhite = Color.white

    // MARK: - Entry Type Colors

    /// Place entry type color (adobeBrick)
    static let entryPlace = adobeBrick

    /// Food entry type color (sunsetGold)
    static let entryFood = sunsetGold

    /// Stay entry type color (mossGreen)
    static let entryStay = mossGreen

    /// Experience entry type color (midnightNavy)
    static let entryExperience = midnightNavy

    // MARK: - UIKit Colors (for ShareViewController compatibility)

    static let midnightNavyUI = UIColor(red: 23/255, green: 42/255, blue: 58/255, alpha: 1.0)
    static let warmCreamUI = UIColor(red: 253/255, green: 246/255, blue: 237/255, alpha: 1.0)
    static let sunsetGoldUI = UIColor(red: 244/255, green: 194/255, blue: 78/255, alpha: 1.0)
    static let adobeBrickUI = UIColor(red: 193/255, green: 84/255, blue: 62/255, alpha: 1.0)
    static let mossGreenUI = UIColor(red: 84/255, green: 122/255, blue: 95/255, alpha: 1.0)
    static let paperBeigeUI = UIColor(red: 245/255, green: 236/255, blue: 224/255, alpha: 1.0)
    static let stormGrayUI = UIColor(red: 102/255, green: 109/255, blue: 122/255, alpha: 1.0)
}

// MARK: - Opacity Helpers

extension Color {
    func opacity(_ value: Double) -> Color {
        self.opacity(value)
    }
}

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

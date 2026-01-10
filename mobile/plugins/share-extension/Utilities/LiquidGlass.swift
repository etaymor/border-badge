/**
 * LiquidGlass - Glass morphism styling for SwiftUI
 *
 * Matches the liquid glass design system from the React Native app.
 */

import SwiftUI

enum LiquidGlass {
    // MARK: - View Modifiers

    /// Container style: semi-transparent white with thin border
    struct ContainerStyle: ViewModifier {
        func body(content: Content) -> some View {
            content
                .background(Color.white.opacity(0.55))
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(Color.white, lineWidth: 1.5)
                )
                .shadow(
                    color: BrandColors.midnightNavy.opacity(0.12),
                    radius: 15,
                    x: 0,
                    y: 4
                )
        }
    }

    /// Floating card style: more opaque white with thicker border
    struct FloatingCardStyle: ViewModifier {
        func body(content: Content) -> some View {
            content
                .background(Color.white.opacity(0.75))
                .clipShape(RoundedRectangle(cornerRadius: 24))
                .overlay(
                    RoundedRectangle(cornerRadius: 24)
                        .stroke(Color.white, lineWidth: 2)
                )
                .shadow(
                    color: BrandColors.midnightNavy.opacity(0.15),
                    radius: 20,
                    x: 0,
                    y: 8
                )
        }
    }

    /// Input field style: lighter glass effect
    struct InputStyle: ViewModifier {
        func body(content: Content) -> some View {
            content
                .background(Color.white.opacity(0.5))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.white, lineWidth: 1.5)
                )
        }
    }

    /// Button style with glass effect
    struct ButtonStyle: ViewModifier {
        func body(content: Content) -> some View {
            content
                .background(Color.white.opacity(0.6))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.white, lineWidth: 1.5)
                )
        }
    }
}

// MARK: - View Extensions

extension View {
    /// Apply container glass styling
    func glassContainer() -> some View {
        modifier(LiquidGlass.ContainerStyle())
    }

    /// Apply floating card glass styling
    func glassCard() -> some View {
        modifier(LiquidGlass.FloatingCardStyle())
    }

    /// Apply input field glass styling
    func glassInput() -> some View {
        modifier(LiquidGlass.InputStyle())
    }

    /// Apply button glass styling
    func glassButton() -> some View {
        modifier(LiquidGlass.ButtonStyle())
    }
}

// MARK: - Primary Button Style

struct PrimaryButtonStyle: ButtonStyle {
    let isEnabled: Bool

    init(isEnabled: Bool = true) {
        self.isEnabled = isEnabled
    }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundColor(BrandColors.midnightNavy)
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(isEnabled ? BrandColors.sunsetGold : BrandColors.stormGray.opacity(0.3))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .scaleEffect(configuration.isPressed ? 0.98 : 1.0)
            .animation(.easeInOut(duration: 0.1), value: configuration.isPressed)
    }
}

// MARK: - Secondary Button Style

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .medium))
            .foregroundColor(BrandColors.stormGray)
            .padding(.vertical, 12)
            .padding(.horizontal, 20)
            .glassButton()
            .scaleEffect(configuration.isPressed ? 0.98 : 1.0)
            .animation(.easeInOut(duration: 0.1), value: configuration.isPressed)
    }
}

// MARK: - Section Label Style

struct SectionLabel: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .medium))
            .tracking(1.5)
            .foregroundColor(BrandColors.midnightNavy.opacity(0.7))
    }
}

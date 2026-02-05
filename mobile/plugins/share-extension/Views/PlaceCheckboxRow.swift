/**
 * PlaceCheckboxRow - Individual place row in multi-place selection list
 *
 * Matches the React Native PlaceCheckboxItem component:
 * - Animated checkbox for selection toggle
 * - Place name (Playfair) and address (lower opacity)
 * - Icon-only entry type pill (tappable to cycle types)
 * - Edit button for place search (hidden by default)
 */

import SwiftUI

struct PlaceCheckboxRow: View {
    @Binding var selection: PlaceSelection
    let showEditButton: Bool
    let onEditPlace: () -> Void

    init(selection: Binding<PlaceSelection>, showEditButton: Bool = false, onEditPlace: @escaping () -> Void) {
        self._selection = selection
        self.showEditButton = showEditButton
        self.onEditPlace = onEditPlace
    }

    var body: some View {
        HStack(spacing: 14) {
            // Checkbox - circular style matching React Native
            Button(
                action: {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) {
                        selection.isSelected.toggle()
                    }
                },
                label: {
                    ZStack {
                        Circle()
                            .strokeBorder(
                                selection.isSelected
                                    ? BrandColors.sunsetGold
                                    : BrandColors.midnightNavy.opacity(0.25),
                                lineWidth: 2
                            )
                            .background(
                                Circle()
                                    .fill(selection.isSelected ? BrandColors.sunsetGold : Color.clear)
                            )
                            .frame(width: 22, height: 22)

                        if selection.isSelected {
                            Image(systemName: "checkmark")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundColor(.white)
                        }
                    }
                }
            )
            .buttonStyle(ScaleButtonStyle(scale: 0.9))

            // Place info
            VStack(alignment: .leading, spacing: 2) {
                Text(selection.place.name)
                    .font(Typography.header(16))
                    .foregroundColor(BrandColors.midnightNavy)
                    .lineLimit(1)

                if let address = selection.place.address {
                    Text(address)
                        .font(Typography.body(12))
                        .foregroundColor(BrandColors.stormGray.opacity(0.6))
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 8)

            // Entry type icon pill (tappable to cycle)
            Button(
                action: {
                    withAnimation(.spring(response: 0.25, dampingFraction: 0.6)) {
                        selection.cycleEntryType()
                    }
                },
                label: { EntryTypeIconPill(entryType: selection.entryType) }
            )
            .buttonStyle(ScaleButtonStyle(scale: 0.92))

            // Edit button (hidden by default)
            if showEditButton {
                Button(action: onEditPlace) {
                    Image(systemName: "pencil")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(BrandColors.stormGray)
                        .frame(width: 32, height: 32)
                        .background(Color.black.opacity(0.05))
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 14)
        .padding(.horizontal, 16)
        .background(selection.isSelected ? BrandColors.sunsetGold.opacity(0.06) : Color.clear)
        .contentShape(Rectangle())
    }
}

// MARK: - Scale Button Style for tap feedback

private struct ScaleButtonStyle: ButtonStyle {
    let scale: CGFloat

    init(scale: CGFloat = 0.95) {
        self.scale = scale
    }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1.0)
            .animation(.spring(response: 0.2, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

// MARK: - Entry Type Icon Pill (icon only, no label)

private struct EntryTypeIconPill: View {
    let entryType: EntryType

    var body: some View {
        Image(systemName: entryType.icon)
            .font(.system(size: 16, weight: .medium))
            .foregroundColor(entryType.color)
            .frame(width: 32, height: 32)
            .background(entryType.color.opacity(0.15))
            .clipShape(Circle())
    }
}

#if DEBUG
struct PlaceCheckboxRow_Previews: PreviewProvider {
    static var previews: some View {
        VStack(spacing: 0) {
            // Selected place
            PlaceCheckboxRow(
                selection: .constant(PlaceSelection(
                    place: DetectedPlace(
                        googlePlaceId: "ChIJ123",
                        name: "Tartine Bakery",
                        address: "600 Guerrero St, San Francisco, CA",
                        confidence: 0.9,
                        types: ["bakery", "cafe"]
                    ),
                    isSelected: true
                )),
                onEditPlace: {}
            )

            Divider()
                .padding(.horizontal, 16)

            // Unselected place
            PlaceCheckboxRow(
                selection: .constant(PlaceSelection(
                    place: DetectedPlace(
                        googlePlaceId: "ChIJ456",
                        name: "Golden Gate Park",
                        address: "San Francisco, CA",
                        confidence: 0.8,
                        types: ["park", "tourist_attraction"]
                    ),
                    isSelected: false
                )),
                onEditPlace: {}
            )
        }
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(.white.opacity(0.6))
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .strokeBorder(.white.opacity(0.8), lineWidth: 1.5)
                )
        )
        .padding()
        .background(BrandColors.warmCream)
    }
}
#endif

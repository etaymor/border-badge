/**
 * PlaceCheckboxRow - Individual place row in multi-place selection list
 *
 * Matches the React Native PlaceCheckboxItem component:
 * - Checkbox for selection toggle
 * - Place name and address
 * - Entry type chip (tappable to cycle types)
 * - Edit button for place search
 */

import SwiftUI

struct PlaceCheckboxRow: View {
    @Binding var selection: PlaceSelection
    let onEditPlace: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            // Checkbox
            Button(
                action: { selection.isSelected.toggle() },
                label: {
                    Image(systemName: selection.isSelected ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 24))
                        .foregroundColor(
                            selection.isSelected ? BrandColors.mossGreen : BrandColors.stormGray.opacity(0.5)
                        )
                }
            )
            .buttonStyle(.plain)

            // Place info
            VStack(alignment: .leading, spacing: 4) {
                Text(selection.place.name)
                    .font(Typography.semibold(15))
                    .foregroundColor(BrandColors.midnightNavy)
                    .lineLimit(1)

                if let address = selection.place.address {
                    Text(address)
                        .font(Typography.body(13))
                        .foregroundColor(BrandColors.stormGray)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 8)

            // Entry type chip (tappable to cycle)
            Button(
                action: { selection.cycleEntryType() },
                label: { EntryTypeChip(entryType: selection.entryType) }
            )
            .buttonStyle(.plain)

            // Edit button
            Button(action: onEditPlace) {
                Image(systemName: "pencil")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(BrandColors.stormGray)
                    .frame(width: 32, height: 32)
                    .background(Color.white.opacity(0.5))
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
        }
        .padding(12)
        .background(Color.white.opacity(selection.isSelected ? 0.8 : 0.4))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(
                    selection.isSelected ? BrandColors.mossGreen.opacity(0.3) : Color.clear,
                    lineWidth: 1
                )
        )
        .opacity(selection.isSelected ? 1.0 : 0.7)
    }
}

// MARK: - Entry Type Chip

private struct EntryTypeChip: View {
    let entryType: EntryType

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: entryType.icon)
                .font(.system(size: 10, weight: .medium))

            Text(entryType.label)
                .font(Typography.body(11))
        }
        .foregroundColor(entryType.color)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(entryType.color.opacity(0.1))
        .clipShape(Capsule())
    }
}

#if DEBUG
struct PlaceCheckboxRow_Previews: PreviewProvider {
    static var previews: some View {
        VStack(spacing: 12) {
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
        .padding()
        .background(BrandColors.warmCream)
    }
}
#endif

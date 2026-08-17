/**
 * MultiPlaceListView - Multi-place selection list for share extension
 *
 * Matches the React Native MultiPlaceList component:
 * - Glass container with blur effect
 * - Section header with select all / clear all actions
 * - Shows all detected places with checkboxes
 * - Each place has tinted entry type chip
 */

import SwiftUI

struct MultiPlaceListView: View {
    @Binding var selections: [PlaceSelection]
    let onEditPlace: (Int) -> Void  // Pass index of place to edit

    private var selectedCount: Int {
        selections.filter { $0.isSelected }.count
    }

    private var allSelected: Bool {
        selectedCount == selections.count
    }

    var body: some View {
        VStack(spacing: 12) {
            // Section header
            HStack {
                Text("SELECT PLACES (\(selectedCount) SELECTED)")
                    .font(Typography.sectionLabel())
                    .foregroundColor(BrandColors.stormGray)
                    .tracking(1.5)

                Spacer()

                Button(action: toggleAll) {
                    Text(allSelected ? "Clear all" : "Select all")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(BrandColors.sunsetGold)
                }
            }
            .padding(.horizontal, 4)

            // Glass container
            VStack(spacing: 0) {
                ForEach(selections.indices, id: \.self) { index in
                    PlaceCheckboxRow(
                        selection: $selections[index],
                        onEditPlace: { onEditPlace(index) }
                    )

                    // Separator (not on last item)
                    if index < selections.count - 1 {
                        Rectangle()
                            .fill(BrandColors.midnightNavy.opacity(0.06))
                            .frame(height: 1)
                            .padding(.horizontal, 16)
                    }
                }
            }
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(.white.opacity(0.6))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(.white.opacity(0.8), lineWidth: 1.5)
            )
            .shadow(color: BrandColors.midnightNavy.opacity(0.08), radius: 12, x: 0, y: 4)
        }
    }

    private func toggleAll() {
        let newValue = !allSelected
        for index in selections.indices {
            selections[index].isSelected = newValue
        }
    }
}

#if DEBUG
struct MultiPlaceListView_Previews: PreviewProvider {
    static var previews: some View {
        MultiPlaceListView(
            selections: .constant([
                PlaceSelection(
                    place: DetectedPlace(
                        googlePlaceId: "ChIJ123",
                        name: "Tartine Bakery",
                        address: "600 Guerrero St, San Francisco, CA",
                        confidence: 0.9,
                        types: ["bakery", "cafe"]
                    ),
                    isSelected: true
                ),
                PlaceSelection(
                    place: DetectedPlace(
                        googlePlaceId: "ChIJ456",
                        name: "Golden Gate Park",
                        address: "San Francisco, CA",
                        confidence: 0.8,
                        types: ["park", "tourist_attraction"]
                    ),
                    isSelected: true
                ),
                PlaceSelection(
                    place: DetectedPlace(
                        googlePlaceId: "ChIJ789",
                        name: "Dolores Park",
                        address: "San Francisco, CA",
                        confidence: 0.7,
                        types: ["park"]
                    ),
                    isSelected: false
                )
            ]),
            onEditPlace: { _ in }
        )
        .padding()
        .background(BrandColors.warmCream)
    }
}
#endif

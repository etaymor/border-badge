/**
 * MultiPlaceListView - Multi-place selection list for share extension
 *
 * Matches the React Native MultiPlaceList component:
 * - Shows all detected places with checkboxes
 * - Each place has entry type chip and edit button
 * - Scrollable list with consistent styling
 */

import SwiftUI

struct MultiPlaceListView: View {
    @Binding var selections: [PlaceSelection]
    let onEditPlace: (Int) -> Void  // Pass index of place to edit

    var body: some View {
        VStack(spacing: 8) {
            ForEach(selections.indices, id: \.self) { index in
                PlaceCheckboxRow(
                    selection: $selections[index],
                    onEditPlace: { onEditPlace(index) }
                )
            }
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

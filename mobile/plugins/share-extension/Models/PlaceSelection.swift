/**
 * PlaceSelection - Model for tracking place selection state in multi-place mode
 *
 * Mirrors the TypeScript PlaceSelection interface from MultiPlaceList.tsx
 */

import Foundation

/// Tracks selection state and entry type for a detected place
struct PlaceSelection: Identifiable, Equatable {
    let id: String  // Use place name as unique identifier within a post
    var isSelected: Bool
    var entryType: EntryType
    let place: DetectedPlace

    init(place: DetectedPlace, isSelected: Bool = true) {
        self.id = place.name
        self.isSelected = isSelected
        self.place = place
        // Infer entry type from LLM prediction or Google Places types
        if let llmType = place.llmEntryType,
           let type = EntryType(rawValue: llmType) {
            self.entryType = type
        } else {
            self.entryType = EntryType.from(
                primaryType: place.primaryType,
                types: place.types
            )
        }
    }

    /// Convert to PlaceToSave for API request
    func toPlaceToSave() -> PlaceToSave {
        PlaceToSave.from(place: place, entryType: entryType.rawValue)
    }

    /// Cycle to the next entry type (place -> food -> stay -> experience -> place)
    mutating func cycleEntryType() {
        let allTypes = EntryType.allCases
        guard let currentIndex = allTypes.firstIndex(of: entryType) else { return }
        let nextIndex = (currentIndex + 1) % allTypes.count
        entryType = allTypes[nextIndex]
    }
}

// MARK: - Collection Helpers

extension Array where Element == PlaceSelection {
    /// Create selections from an array of detected places
    static func from(places: [DetectedPlace]) -> [PlaceSelection] {
        places.map { PlaceSelection(place: $0) }
    }

    /// Get only the selected places
    var selected: [PlaceSelection] {
        filter { $0.isSelected }
    }

    /// Get selected places as PlaceToSave array for batch save
    var placesToSave: [PlaceToSave] {
        selected.map { $0.toPlaceToSave() }
    }

    /// Count of selected places
    var selectedCount: Int {
        selected.count
    }
}

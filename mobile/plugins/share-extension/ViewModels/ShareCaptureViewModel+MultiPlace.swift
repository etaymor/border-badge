/**
 * ShareCaptureViewModel+MultiPlace - Multi-place handling extensions
 */

import Foundation

// MARK: - Multi-Place Handlers

extension ShareCaptureViewModel {
    /// Start editing a place at the given index (opens location search)
    func startEditingPlace(at index: Int) {
        guard index >= 0 && index < placeSelections.count else { return }
        editingPlaceIndex = index
    }

    /// Update an edited place with a new selection
    func updateEditedPlace(_ place: DetectedPlace) {
        guard let index = editingPlaceIndex,
              index >= 0 && index < placeSelections.count else { return }

        placeSelections[index] = PlaceSelection(
            place: place,
            isSelected: placeSelections[index].isSelected
        )
        editingPlaceIndex = nil
    }

    /// Cancel place editing
    func cancelEditingPlace() {
        editingPlaceIndex = nil
    }

    /// Initialize multi-place selections from ingest response
    func initializeMultiPlaceSelections(from places: [DetectedPlace]) {
        if places.count > 1 {
            placeSelections = .from(places: places)
        } else {
            placeSelections = []
        }
    }
}

/**
 * PlaceSelectionTests - Unit tests for PlaceSelection model and array extensions
 *
 * Tests the multi-place selection state management including:
 * - Identity key generation
 * - Entry type inference from LLM and Google Places types
 * - Entry type cycling
 * - Array extension helpers (selected, placesToSave, etc.)
 */

import XCTest
@testable import ShareExtension

final class PlaceSelectionTests: XCTestCase {

    // MARK: - Identity Key Tests

    func testIdentityKeyUsesGooglePlaceIdWhenPresent() {
        // Given: A place with a Google Place ID
        let place = DetectedPlace(
            googlePlaceId: "ChIJ123ABC",
            name: "Test Restaurant"
        )

        // When
        let key = PlaceSelection.identityKey(for: place)

        // Then: Should use the Google Place ID
        XCTAssertEqual(key, "ChIJ123ABC")
    }

    func testIdentityKeyUsesCompositeKeyWithoutGooglePlaceId() {
        // Given: A place without a Google Place ID
        let place = DetectedPlace(
            name: "Test Restaurant",
            address: "123 Main St",
            city: "Paris",
            country: "France"
        )

        // When
        let key = PlaceSelection.identityKey(for: place)

        // Then: Should use composite key
        XCTAssertEqual(key, "test restaurant|paris|france|123 main st")
    }

    func testIdentityKeyHandlesEmptyGooglePlaceId() {
        // Given: A place with empty Google Place ID
        let place = DetectedPlace(
            googlePlaceId: "",
            name: "Test Restaurant",
            city: "Paris"
        )

        // When
        let key = PlaceSelection.identityKey(for: place)

        // Then: Should use composite key since place ID is empty
        XCTAssertTrue(key.contains("test restaurant"))
        XCTAssertTrue(key.contains("paris"))
    }

    func testIdentityKeyNormalizesCase() {
        // Given: Places with different casing
        let place1 = DetectedPlace(name: "TEST RESTAURANT", city: "PARIS")
        let place2 = DetectedPlace(name: "test restaurant", city: "paris")

        // When
        let key1 = PlaceSelection.identityKey(for: place1)
        let key2 = PlaceSelection.identityKey(for: place2)

        // Then: Should produce same key
        XCTAssertEqual(key1, key2)
    }

    func testIdentityKeyTrimsWhitespace() {
        // Given: Places with whitespace
        let place1 = DetectedPlace(name: "  Test Restaurant  ", city: " Paris ")
        let place2 = DetectedPlace(name: "Test Restaurant", city: "Paris")

        // When
        let key1 = PlaceSelection.identityKey(for: place1)
        let key2 = PlaceSelection.identityKey(for: place2)

        // Then: Should produce same key
        XCTAssertEqual(key1, key2)
    }

    // MARK: - Entry Type Inference Tests

    func testInfersEntryTypeFromLLMPrediction() {
        // Given: A place with LLM-predicted entry type
        let place = DetectedPlace(
            googlePlaceId: "ChIJ123",
            name: "Joe's Diner",
            primaryType: "establishment",  // Not food
            llmEntryType: "food"  // LLM says it's food
        )

        // When
        let selection = PlaceSelection(place: place)

        // Then: Should use LLM prediction over Google types
        XCTAssertEqual(selection.entryType, .food)
    }

    func testInfersEntryTypeFromGoogleTypesWhenNoLLM() {
        // Given: A place without LLM prediction but with Google types
        let place = DetectedPlace(
            googlePlaceId: "ChIJ123",
            name: "Hilton Hotel",
            primaryType: "hotel",
            types: ["hotel", "lodging"]
        )

        // When
        let selection = PlaceSelection(place: place)

        // Then: Should infer from Google types
        XCTAssertEqual(selection.entryType, .stay)
    }

    func testDefaultsToPlaceWhenNoTypeInfo() {
        // Given: A place with no type information
        let place = DetectedPlace(
            googlePlaceId: "ChIJ123",
            name: "Unknown Location"
        )

        // When
        let selection = PlaceSelection(place: place)

        // Then: Should default to .place
        XCTAssertEqual(selection.entryType, .place)
    }

    func testLLMPredictionTakesPrecedenceOverGoogleTypes() {
        // Given: Conflicting LLM prediction and Google types
        let place = DetectedPlace(
            googlePlaceId: "ChIJ123",
            name: "Cafe Museum",
            primaryType: "cafe",  // Google says food
            types: ["cafe", "restaurant"],
            llmEntryType: "experience"  // LLM says experience
        )

        // When
        let selection = PlaceSelection(place: place)

        // Then: Should use LLM prediction
        XCTAssertEqual(selection.entryType, .experience)
    }

    // MARK: - Default Selection State Tests

    func testDefaultsToSelected() {
        // Given
        let place = DetectedPlace(name: "Test Place")

        // When
        let selection = PlaceSelection(place: place)

        // Then
        XCTAssertTrue(selection.isSelected)
    }

    func testCanCreateUnselected() {
        // Given
        let place = DetectedPlace(name: "Test Place")

        // When
        let selection = PlaceSelection(place: place, isSelected: false)

        // Then
        XCTAssertFalse(selection.isSelected)
    }

    // MARK: - Entry Type Cycling Tests

    func testCycleEntryTypeFromPlace() {
        // Given
        var selection = PlaceSelection(place: DetectedPlace(name: "Test"))
        selection.entryType = .place

        // When
        selection.cycleEntryType()

        // Then
        XCTAssertEqual(selection.entryType, .food)
    }

    func testCycleEntryTypeFromFood() {
        // Given
        var selection = PlaceSelection(place: DetectedPlace(name: "Test"))
        selection.entryType = .food

        // When
        selection.cycleEntryType()

        // Then
        XCTAssertEqual(selection.entryType, .stay)
    }

    func testCycleEntryTypeFromStay() {
        // Given
        var selection = PlaceSelection(place: DetectedPlace(name: "Test"))
        selection.entryType = .stay

        // When
        selection.cycleEntryType()

        // Then
        XCTAssertEqual(selection.entryType, .experience)
    }

    func testCycleEntryTypeWrapsAround() {
        // Given
        var selection = PlaceSelection(place: DetectedPlace(name: "Test"))
        selection.entryType = .experience

        // When
        selection.cycleEntryType()

        // Then: Should wrap back to place
        XCTAssertEqual(selection.entryType, .place)
    }

    // MARK: - toPlaceToSave Tests

    func testToPlaceToSaveWithValidGooglePlaceId() {
        // Given
        let place = DetectedPlace(
            googlePlaceId: "ChIJ123",
            name: "Test Restaurant",
            address: "123 Main St",
            city: "Paris",
            country: "France",
            countryCode: "FR"
        )
        let selection = PlaceSelection(place: place)

        // When
        let placeToSave = selection.toPlaceToSave()

        // Then
        XCTAssertNotNil(placeToSave)
        XCTAssertEqual(placeToSave?.googlePlaceId, "ChIJ123")
        XCTAssertEqual(placeToSave?.name, "Test Restaurant")
        XCTAssertEqual(placeToSave?.entryType, selection.entryType.rawValue)
    }

    func testToPlaceToSaveReturnsNilWithoutGooglePlaceId() {
        // Given: A place without a Google Place ID
        let place = DetectedPlace(name: "Manual Entry Place")
        let selection = PlaceSelection(place: place)

        // When
        let placeToSave = selection.toPlaceToSave()

        // Then: Should return nil
        XCTAssertNil(placeToSave)
    }

    func testToPlaceToSaveReturnsNilWithEmptyGooglePlaceId() {
        // Given: A place with empty Google Place ID
        let place = DetectedPlace(googlePlaceId: "", name: "Test")
        let selection = PlaceSelection(place: place)

        // When
        let placeToSave = selection.toPlaceToSave()

        // Then: Should return nil
        XCTAssertNil(placeToSave)
    }

    // MARK: - Equatable Tests

    func testPlaceSelectionsAreEqual() {
        // Given
        let place = DetectedPlace(googlePlaceId: "ChIJ123", name: "Test")
        let selection1 = PlaceSelection(place: place)
        let selection2 = PlaceSelection(place: place)

        // Then
        XCTAssertEqual(selection1, selection2)
    }

    func testPlaceSelectionsWithDifferentSelectionState() {
        // Given
        let place = DetectedPlace(googlePlaceId: "ChIJ123", name: "Test")
        let selection1 = PlaceSelection(place: place, isSelected: true)
        let selection2 = PlaceSelection(place: place, isSelected: false)

        // Then: Different selection state means not equal
        XCTAssertNotEqual(selection1, selection2)
    }
}

// MARK: - Array Extension Tests

final class PlaceSelectionArrayTests: XCTestCase {

    func testFromPlacesCreatesSelections() {
        // Given
        let places = [
            DetectedPlace(googlePlaceId: "ChIJ1", name: "Place 1"),
            DetectedPlace(googlePlaceId: "ChIJ2", name: "Place 2"),
            DetectedPlace(googlePlaceId: "ChIJ3", name: "Place 3"),
        ]

        // When
        let selections = [PlaceSelection].from(places: places)

        // Then
        XCTAssertEqual(selections.count, 3)
        XCTAssertTrue(selections.allSatisfy { $0.isSelected })
    }

    func testSelectedFiltersCorrectly() {
        // Given
        var selections = [
            PlaceSelection(place: DetectedPlace(name: "Place 1"), isSelected: true),
            PlaceSelection(place: DetectedPlace(name: "Place 2"), isSelected: false),
            PlaceSelection(place: DetectedPlace(name: "Place 3"), isSelected: true),
        ]

        // When
        let selected = selections.selected

        // Then
        XCTAssertEqual(selected.count, 2)
        XCTAssertTrue(selected.allSatisfy { $0.isSelected })
    }

    func testSelectedCountReturnsCorrectCount() {
        // Given
        let selections = [
            PlaceSelection(place: DetectedPlace(name: "Place 1"), isSelected: true),
            PlaceSelection(place: DetectedPlace(name: "Place 2"), isSelected: false),
            PlaceSelection(place: DetectedPlace(name: "Place 3"), isSelected: true),
            PlaceSelection(place: DetectedPlace(name: "Place 4"), isSelected: false),
        ]

        // Then
        XCTAssertEqual(selections.selectedCount, 2)
    }

    func testPlacesToSaveOnlyIncludesSelectedWithValidIds() {
        // Given
        let selections = [
            PlaceSelection(place: DetectedPlace(googlePlaceId: "ChIJ1", name: "Place 1"), isSelected: true),
            PlaceSelection(place: DetectedPlace(googlePlaceId: "ChIJ2", name: "Place 2"), isSelected: false),
            PlaceSelection(place: DetectedPlace(name: "No ID"), isSelected: true),  // No Google ID
            PlaceSelection(place: DetectedPlace(googlePlaceId: "ChIJ3", name: "Place 3"), isSelected: true),
        ]

        // When
        let placesToSave = selections.placesToSave

        // Then: Only selected places with valid Google IDs
        XCTAssertEqual(placesToSave.count, 2)
        XCTAssertEqual(placesToSave[0].name, "Place 1")
        XCTAssertEqual(placesToSave[1].name, "Place 3")
    }

    func testPlacesToSaveReturnsEmptyWhenNoneSelected() {
        // Given
        let selections = [
            PlaceSelection(place: DetectedPlace(googlePlaceId: "ChIJ1", name: "Place 1"), isSelected: false),
            PlaceSelection(place: DetectedPlace(googlePlaceId: "ChIJ2", name: "Place 2"), isSelected: false),
        ]

        // When
        let placesToSave = selections.placesToSave

        // Then
        XCTAssertTrue(placesToSave.isEmpty)
    }

    func testPlacesToSavePreservesEntryType() {
        // Given
        var selection = PlaceSelection(
            place: DetectedPlace(googlePlaceId: "ChIJ1", name: "Restaurant")
        )
        selection.entryType = .food

        // When
        let placesToSave = [selection].placesToSave

        // Then
        XCTAssertEqual(placesToSave.first?.entryType, "food")
    }

    func testEmptyArrayReturnsEmptySelected() {
        // Given
        let selections: [PlaceSelection] = []

        // Then
        XCTAssertEqual(selections.selected.count, 0)
        XCTAssertEqual(selections.selectedCount, 0)
        XCTAssertEqual(selections.placesToSave.count, 0)
    }
}

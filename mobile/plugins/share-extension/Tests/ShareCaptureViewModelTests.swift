/**
 * ShareCaptureViewModelTests - Unit tests for ShareCaptureViewModel
 *
 * Tests the main state management logic for the share capture flow.
 */

import XCTest
@testable import ShareExtension

@MainActor
final class ShareCaptureViewModelTests: XCTestCase {

    var viewModel: ShareCaptureViewModel!

    override func setUp() async throws {
        try await super.setUp()
        viewModel = ShareCaptureViewModel()
    }

    override func tearDown() async throws {
        viewModel = nil
        try await super.tearDown()
    }

    // MARK: - Initial State Tests

    func testInitialState() {
        XCTAssertEqual(viewModel.state, .loading(message: "Processing link..."))
        XCTAssertNil(viewModel.ingestResult)
        XCTAssertNil(viewModel.selectedPlace)
        XCTAssertNil(viewModel.selectedTripId)
        XCTAssertEqual(viewModel.entryType, .place)
        XCTAssertFalse(viewModel.hasSelectedType)
        XCTAssertEqual(viewModel.notes, "")
        XCTAssertFalse(viewModel.isManualEntryMode)
    }

    // MARK: - Computed Properties Tests

    func testProviderReturnsNilWhenNoIngestResult() {
        XCTAssertNil(viewModel.provider)
    }

    func testProviderNameReturnsLinkWhenNoProvider() {
        XCTAssertEqual(viewModel.providerName, "Link")
    }

    func testCanSaveReturnsFalseWithoutPlaceAndTrip() {
        XCTAssertFalse(viewModel.canSave)
    }

    func testCanSaveReturnsFalseWithOnlyPlace() {
        // Given: Only place is selected
        viewModel.selectedPlace = DetectedPlace(name: "Test Place")

        // Then
        XCTAssertFalse(viewModel.canSave)
    }

    func testCanSaveReturnsFalseWithOnlyTrip() {
        // Given: Only trip is selected
        viewModel.selectedTripId = "trip-123"

        // Then
        XCTAssertFalse(viewModel.canSave)
    }

    func testCanSaveReturnsTrueWithPlaceAndTrip() {
        // Given: Both place and trip are selected
        viewModel.selectedPlace = DetectedPlace(name: "Test Place")
        viewModel.selectedTripId = "trip-123"

        // Then
        XCTAssertTrue(viewModel.canSave)
    }

    // MARK: - processURL Tests

    func testProcessURLSetsLoadingState() {
        // When
        viewModel.processURL("https://www.tiktok.com/@user/video/123")

        // Then
        if case .loading(let message) = viewModel.state {
            XCTAssertTrue(message.contains("TikTok"))
        } else {
            XCTFail("Expected loading state")
        }
    }

    func testProcessURLDetectsTikTokProvider() {
        // When
        viewModel.processURL("https://www.tiktok.com/@user/video/123")

        // Then
        if case .loading(let message) = viewModel.state {
            XCTAssertEqual(message, "Processing TikTok...")
        } else {
            XCTFail("Expected loading state")
        }
    }

    func testProcessURLDetectsInstagramProvider() {
        // When
        viewModel.processURL("https://www.instagram.com/reel/ABC123")

        // Then
        if case .loading(let message) = viewModel.state {
            XCTAssertEqual(message, "Processing Instagram...")
        } else {
            XCTFail("Expected loading state")
        }
    }

    func testProcessURLDetectsGenericLink() {
        // When
        viewModel.processURL("https://www.example.com/some-page")

        // Then
        if case .loading(let message) = viewModel.state {
            XCTAssertEqual(message, "Processing link...")
        } else {
            XCTFail("Expected loading state")
        }
    }

    func testProcessURLWithCaption() {
        // When
        viewModel.processURL("https://www.tiktok.com/@user/video/123", caption: "Great spot!")

        // Then: Should process without error
        if case .loading = viewModel.state {
            // Expected
        } else {
            XCTFail("Expected loading state")
        }
    }

    // MARK: - retry Tests

    func testRetryDoesNothingWithEmptyURL() {
        // Given: No URL has been processed
        viewModel.state = .error(.network())

        // When
        viewModel.retry()

        // Then: State should remain error
        if case .error = viewModel.state {
            // Expected - didn't change
        } else {
            XCTFail("State should remain error when retrying with empty URL")
        }
    }

    func testRetrySetsLoadingState() {
        // Given: A URL was processed and resulted in error
        viewModel.processURL("https://www.tiktok.com/@user/video/123")
        viewModel.state = .error(.network())

        // When
        viewModel.retry()

        // Then
        if case .loading(let message) = viewModel.state {
            XCTAssertEqual(message, "Retrying...")
        } else {
            XCTFail("Expected loading state")
        }
    }

    // MARK: - enterManualEntryMode Tests

    func testEnterManualEntryModeSetsFormState() {
        // When
        viewModel.enterManualEntryMode()

        // Then
        XCTAssertTrue(viewModel.isManualEntryMode)
        XCTAssertEqual(viewModel.state, .form)
    }

    // MARK: - selectPlace Tests

    func testSelectPlaceSetsSelectedPlace() {
        // Given
        let place = DetectedPlace(
            googlePlaceId: "ChIJ123",
            name: "Test Restaurant",
            address: "123 Main St"
        )

        // When
        viewModel.selectPlace(place)

        // Then
        XCTAssertEqual(viewModel.selectedPlace, place)
    }

    func testSelectPlaceInfersEntryTypeFromPlace() {
        // Given: A restaurant place
        let place = DetectedPlace(
            googlePlaceId: "ChIJ123",
            name: "Test Restaurant",
            primaryType: "restaurant",
            types: ["restaurant", "food"]
        )

        // When
        viewModel.selectPlace(place)

        // Then: Should infer food type
        XCTAssertEqual(viewModel.entryType, .food)
    }

    func testSelectPlaceDoesNotOverrideManualTypeSelection() {
        // Given: User has manually selected a type
        viewModel.selectEntryType(.experience)
        XCTAssertTrue(viewModel.hasSelectedType)

        // And: A restaurant place
        let place = DetectedPlace(
            googlePlaceId: "ChIJ123",
            name: "Test Restaurant",
            primaryType: "restaurant",
            types: ["restaurant"]
        )

        // When
        viewModel.selectPlace(place)

        // Then: Should keep manual selection
        XCTAssertEqual(viewModel.entryType, .experience)
    }

    // MARK: - selectEntryType Tests

    func testSelectEntryTypeSetsType() {
        // When
        viewModel.selectEntryType(.food)

        // Then
        XCTAssertEqual(viewModel.entryType, .food)
        XCTAssertTrue(viewModel.hasSelectedType)
    }

    func testSelectEntryTypeMarksAsManuallySelected() {
        // Given
        XCTAssertFalse(viewModel.hasSelectedType)

        // When
        viewModel.selectEntryType(.stay)

        // Then
        XCTAssertTrue(viewModel.hasSelectedType)
    }

    // MARK: - resetEntryType Tests

    func testResetEntryTypeClearsManualSelection() {
        // Given
        viewModel.selectEntryType(.experience)
        XCTAssertTrue(viewModel.hasSelectedType)

        // When
        viewModel.resetEntryType()

        // Then
        XCTAssertFalse(viewModel.hasSelectedType)
    }

    // MARK: - save Tests

    func testSaveDoesNothingWithoutPlace() {
        // Given
        viewModel.selectedTripId = "trip-123"
        viewModel.selectedPlace = nil
        viewModel.state = .form

        // When
        viewModel.save()

        // Then: State should not change to saving
        XCTAssertEqual(viewModel.state, .form)
    }

    func testSaveDoesNothingWithoutTrip() {
        // Given
        viewModel.selectedPlace = DetectedPlace(name: "Test")
        viewModel.selectedTripId = nil
        viewModel.state = .form

        // When
        viewModel.save()

        // Then: State should not change to saving
        XCTAssertEqual(viewModel.state, .form)
    }

    func testSaveSetsSavingState() {
        // Given: Both place and trip are selected
        viewModel.selectedPlace = DetectedPlace(name: "Test")
        viewModel.selectedTripId = "trip-123"
        viewModel.state = .form

        // When
        viewModel.save()

        // Then
        XCTAssertEqual(viewModel.state, .saving)
    }

    // MARK: - ShareCaptureError Tests

    func testNetworkError() {
        let error = ShareCaptureError.network()

        XCTAssertTrue(error.message.contains("Network"))
        XCTAssertTrue(error.canRetry)
        XCTAssertTrue(error.canManualEntry)
        XCTAssertTrue(error.canSaveForLater)
    }

    func testTimeoutError() {
        let error = ShareCaptureError.timeout()

        XCTAssertTrue(error.message.contains("timed out"))
        XCTAssertTrue(error.canRetry)
        XCTAssertTrue(error.canManualEntry)
        XCTAssertTrue(error.canSaveForLater)
    }

    func testUnauthorizedError() {
        let error = ShareCaptureError.unauthorized()

        XCTAssertTrue(error.message.contains("sign in"))
        XCTAssertFalse(error.canRetry)
        XCTAssertFalse(error.canManualEntry)
        XCTAssertTrue(error.canSaveForLater)
    }

    func testInvalidURLError() {
        let error = ShareCaptureError.invalidURL()

        XCTAssertTrue(error.message.contains("TikTok") || error.message.contains("Instagram"))
        XCTAssertFalse(error.canRetry)
        XCTAssertTrue(error.canManualEntry)
        XCTAssertFalse(error.canSaveForLater)
    }

    func testServerError() {
        let error = ShareCaptureError.serverError("Something went wrong")

        XCTAssertEqual(error.message, "Something went wrong")
        XCTAssertTrue(error.canRetry)
        XCTAssertTrue(error.canManualEntry)
        XCTAssertTrue(error.canSaveForLater)
    }

    func testServerErrorWithNilMessage() {
        let error = ShareCaptureError.serverError(nil)

        XCTAssertEqual(error.message, "Something went wrong. Try again.")
        XCTAssertTrue(error.canRetry)
    }

    // MARK: - ShareCaptureState Equatable Tests

    func testShareCaptureStateEquality() {
        XCTAssertEqual(ShareCaptureState.form, ShareCaptureState.form)
        XCTAssertEqual(ShareCaptureState.saving, ShareCaptureState.saving)
        XCTAssertEqual(ShareCaptureState.success, ShareCaptureState.success)
        XCTAssertEqual(
            ShareCaptureState.loading(message: "Test"),
            ShareCaptureState.loading(message: "Test")
        )

        XCTAssertNotEqual(
            ShareCaptureState.loading(message: "A"),
            ShareCaptureState.loading(message: "B")
        )
        XCTAssertNotEqual(ShareCaptureState.form, ShareCaptureState.saving)
    }

    func testShareCaptureStateErrorEquality() {
        let error1 = ShareCaptureError.network()
        let error2 = ShareCaptureError.network()
        let error3 = ShareCaptureError.timeout()

        XCTAssertEqual(
            ShareCaptureState.error(error1),
            ShareCaptureState.error(error2)
        )
        XCTAssertNotEqual(
            ShareCaptureState.error(error1),
            ShareCaptureState.error(error3)
        )
    }

    func testShareCaptureStateSuccessQueuedEquality() {
        XCTAssertEqual(
            ShareCaptureState.successQueued(reason: .networkError),
            ShareCaptureState.successQueued(reason: .networkError)
        )
        XCTAssertEqual(
            ShareCaptureState.successQueued(reason: .serverError),
            ShareCaptureState.successQueued(reason: .serverError)
        )
        XCTAssertEqual(
            ShareCaptureState.successQueued(reason: .unauthenticated),
            ShareCaptureState.successQueued(reason: .unauthenticated)
        )

        XCTAssertNotEqual(
            ShareCaptureState.successQueued(reason: .networkError),
            ShareCaptureState.successQueued(reason: .serverError)
        )
        XCTAssertNotEqual(
            ShareCaptureState.successQueued(reason: .networkError),
            ShareCaptureState.success
        )
    }

    // MARK: - QueueReason Message Tests

    func testQueueReasonMessages() {
        XCTAssertTrue(
            ShareCaptureState.QueueReason.networkError.message.contains("online")
        )
        XCTAssertTrue(
            ShareCaptureState.QueueReason.serverError.message.contains("retry")
        )
        XCTAssertTrue(
            ShareCaptureState.QueueReason.unauthenticated.message.contains("sign in")
        )
    }
}

// MARK: - EntryType Tests

final class EntryTypeTests: XCTestCase {

    func testEntryTypeLabels() {
        XCTAssertEqual(EntryType.place.label, "Place")
        XCTAssertEqual(EntryType.food.label, "Food")
        XCTAssertEqual(EntryType.stay.label, "Stay")
        XCTAssertEqual(EntryType.experience.label, "Experience")
    }

    func testEntryTypeIcons() {
        XCTAssertEqual(EntryType.place.icon, "mappin.circle.fill")
        XCTAssertEqual(EntryType.food.icon, "fork.knife")
        XCTAssertEqual(EntryType.stay.icon, "bed.double.fill")
        XCTAssertEqual(EntryType.experience.icon, "star.fill")
    }

    func testEntryTypeRawValues() {
        XCTAssertEqual(EntryType.place.rawValue, "place")
        XCTAssertEqual(EntryType.food.rawValue, "food")
        XCTAssertEqual(EntryType.stay.rawValue, "stay")
        XCTAssertEqual(EntryType.experience.rawValue, "experience")
    }

    func testEntryTypeFromRestaurant() {
        let entryType = EntryType.from(primaryType: "restaurant", types: [])
        XCTAssertEqual(entryType, .food)
    }

    func testEntryTypeFromCafe() {
        let entryType = EntryType.from(primaryType: "cafe", types: [])
        XCTAssertEqual(entryType, .food)
    }

    func testEntryTypeFromHotel() {
        let entryType = EntryType.from(primaryType: "hotel", types: [])
        XCTAssertEqual(entryType, .stay)
    }

    func testEntryTypeFromMuseum() {
        let entryType = EntryType.from(primaryType: "museum", types: [])
        XCTAssertEqual(entryType, .experience)
    }

    func testEntryTypeFromTouristAttraction() {
        let entryType = EntryType.from(primaryType: "tourist_attraction", types: [])
        XCTAssertEqual(entryType, .experience)
    }

    func testEntryTypeFromUnknownType() {
        let entryType = EntryType.from(primaryType: "unknown_type", types: [])
        XCTAssertEqual(entryType, .place) // Default
    }

    func testEntryTypeFromNilPrimaryType() {
        let entryType = EntryType.from(primaryType: nil, types: [])
        XCTAssertEqual(entryType, .place) // Default
    }

    func testEntryTypeFallsBackToSecondaryTypes() {
        // Given: Primary type is unknown but secondary types contain restaurant
        let entryType = EntryType.from(
            primaryType: "establishment",
            types: ["establishment", "restaurant", "food"]
        )

        // Then: Should infer from secondary types
        XCTAssertEqual(entryType, .food)
    }

    func testEntryTypePrimaryTypeTakesPrecedence() {
        // Given: Primary type is hotel but secondary types contain restaurant
        let entryType = EntryType.from(
            primaryType: "hotel",
            types: ["hotel", "restaurant"]
        )

        // Then: Primary type should take precedence
        XCTAssertEqual(entryType, .stay)
    }
}

// MARK: - QueuedShare Tests

final class QueuedShareTests: XCTestCase {

    func testQueuedShareCreation() {
        // When
        let share = QueuedShare(
            url: "https://www.tiktok.com/@user/video/123",
            caption: "Great spot!",
            reason: .networkError
        )

        // Then
        XCTAssertFalse(share.id.isEmpty)
        XCTAssertEqual(share.url, "https://www.tiktok.com/@user/video/123")
        XCTAssertEqual(share.caption, "Great spot!")
        XCTAssertEqual(share.reason, .networkError)
        XCTAssertNil(share.ingestResult)
        XCTAssertNil(share.selectedTripId)
        XCTAssertNil(share.selectedPlace)
        XCTAssertNil(share.entryType)
        XCTAssertNil(share.notes)
    }

    func testQueuedShareIsValid() {
        // Given: A newly created share
        let share = QueuedShare(
            url: "https://example.com",
            reason: .networkError
        )

        // Then: Should be valid
        XCTAssertTrue(share.isValid)
    }

    func testQueuedShareWithFullData() {
        // Given: Full share data
        let place = DetectedPlace(name: "Test Place")
        let share = QueuedShare(
            url: "https://www.tiktok.com/@user/video/123",
            caption: "Caption",
            reason: .serverError,
            selectedTripId: "trip-123",
            selectedPlace: place,
            entryType: .food,
            notes: "My notes"
        )

        // Then
        XCTAssertEqual(share.selectedTripId, "trip-123")
        XCTAssertEqual(share.selectedPlace, place)
        XCTAssertEqual(share.entryType, .food)
        XCTAssertEqual(share.notes, "My notes")
    }

    func testQueueReasonValues() {
        XCTAssertEqual(QueuedShare.QueueReason.unauthenticated.rawValue, "unauthenticated")
        XCTAssertEqual(QueuedShare.QueueReason.networkError.rawValue, "networkError")
        XCTAssertEqual(QueuedShare.QueueReason.serverError.rawValue, "serverError")
        XCTAssertEqual(QueuedShare.QueueReason.timeout.rawValue, "timeout")
    }

    func testQueuedShareIdentifiable() {
        let share = QueuedShare(url: "https://example.com", reason: .networkError)

        // ID should be the same as id property (Identifiable conformance)
        XCTAssertEqual(share.id, share.id)
        XCTAssertFalse(share.id.isEmpty)
    }
}

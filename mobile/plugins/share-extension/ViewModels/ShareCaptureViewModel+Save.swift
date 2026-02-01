/**
 * ShareCaptureViewModel+Save - Save logic and error handling
 */

import Foundation

// MARK: - Save Methods

extension ShareCaptureViewModel {
    /// Save a single entry to the selected trip
    func saveEntry(place: DetectedPlace, tripId: String) async {
        guard let result = ingestResult else {
            // Manual entry mode - we don't have ingest result
            // For now, just show success since manual entry would need different API
            state = .success
            return
        }

        do {
            let request = SaveToTripRequest(
                tripId: tripId,
                provider: result.provider,
                canonicalUrl: result.canonicalUrl,
                thumbnailUrl: result.thumbnailUrl,
                authorHandle: result.authorHandle,
                title: result.title,
                place: place,
                entryType: entryType.rawValue,
                notes: notes.isEmpty ? nil : notes
            )

            _ = try await apiClient.saveToTrip(request: request)

            // Clear the shared URL from App Group since we processed it
            AppGroupStorage.clearSharedURL()

            // Mark that user has used share extension (for tutorial dismissal in main app)
            AppGroupStorage.markShareExtensionUsed()

            // Increment local usage count (optimistic update for immediate UX feedback)
            // Backend also increments; this ensures Share Extension shows correct remaining count
            AppGroupStorage.incrementShareExtensionUsage()

            // Track success
            AnalyticsQueue.track("share_extension_success", properties: [
                "category": entryType.rawValue,
                "has_location": true
            ])

            state = .success

        } catch let error as APIError {
            handleSaveError(error, place: place, tripId: tripId)
        } catch {
            handleSaveError(.networkError(error), place: place, tripId: tripId)
        }
    }

    /// Save multiple places to the selected trip
    func saveMultiplePlaces(places: [PlaceToSave], tripId: String) async {
        guard let result = ingestResult else {
            state = .success
            return
        }

        do {
            let request = SavePlacesRequest(
                tripId: tripId,
                places: places,
                provider: result.provider,
                canonicalUrl: result.canonicalUrl,
                thumbnailUrl: result.thumbnailUrl,
                authorHandle: result.authorHandle,
                title: result.title,
                notes: notes.isEmpty ? nil : notes
            )

            let response = try await apiClient.savePlaces(request: request)

            // Clear the shared URL from App Group since we processed it
            AppGroupStorage.clearSharedURL()

            // Mark that user has used share extension (for tutorial dismissal in main app)
            AppGroupStorage.markShareExtensionUsed()

            // Increment local usage count (optimistic update for immediate UX feedback)
            // Backend also increments; this ensures Share Extension shows correct remaining count
            AppGroupStorage.incrementShareExtensionUsage()

            // Track success
            AnalyticsQueue.track("share_extension_success", properties: [
                "multi_place": true,
                "place_count": response.savedCount,
                "skipped_duplicates": response.skippedCount,
                "has_location": true
            ])

            state = .success

        } catch let error as APIError {
            handleMultiPlaceSaveError(error, places: places, tripId: tripId)
        } catch {
            handleMultiPlaceSaveError(.networkError(error), places: places, tripId: tripId)
        }
    }
}

// MARK: - Error Handling

extension ShareCaptureViewModel {
    func handleAPIError(_ error: APIError) {
        switch error {
        case .noToken, .unauthorized:
            state = .error(.unauthorized())
        case .timeout:
            state = .error(.timeout())
        case .networkError:
            state = .error(.network())
        case .serverError(let code, let message):
            // 400 = unsupported provider, 422 = validation error
            if code == 400 || code == 422 {
                state = .error(.invalidURL())
            } else {
                state = .error(.serverError(message))
            }
        case .invalidURL, .decodingError:
            state = .error(.invalidURL())
        }
    }

    func handleSaveError(_ error: APIError, place: DetectedPlace, tripId: String) {
        // Queue for later if it's a retryable error
        if error.isRetryable {
            // Determine the queue reason based on error type
            let stateReason: ShareCaptureState.QueueReason
            let queueReason: QueuedShare.QueueReason
            switch error {
            case .networkError:
                stateReason = .networkError
                queueReason = .networkError
            case .timeout:
                stateReason = .networkError
                queueReason = .timeout
            case .noToken, .unauthorized:
                stateReason = .unauthenticated
                queueReason = .unauthenticated
            default:
                stateReason = .serverError
                queueReason = .serverError
            }

            OfflineQueueService.queueShare(
                url: originalURL,
                caption: caption,
                reason: queueReason,
                ingestResult: ingestResult,
                selectedTripId: tripId,
                selectedPlace: place,
                entryType: entryType,
                notes: notes.isEmpty ? nil : notes
            )

            // Track queued due to save error
            AnalyticsQueue.track("share_extension_queued_offline", properties: [
                "reason": queueReason.rawValue
            ])

            state = .successQueued(reason: stateReason)
        } else {
            // Track error
            AnalyticsQueue.track("share_extension_error", properties: [
                "error_type": String(describing: error),
                "stage": "save"
            ])

            state = .error(.serverError(error.errorDescription))
        }
    }

    func handleMultiPlaceSaveError(_ error: APIError, places: [PlaceToSave], tripId: String) {
        // For multi-place, we don't queue - just show error
        // Queueing multiple places is complex and best handled by the main app
        AnalyticsQueue.track("share_extension_error", properties: [
            "error_type": String(describing: error),
            "stage": "multi_place_save",
            "place_count": places.count
        ])

        if error.isRetryable {
            state = .error(.serverError("Failed to save places. Try again."))
        } else {
            state = .error(.serverError(error.errorDescription))
        }
    }
}

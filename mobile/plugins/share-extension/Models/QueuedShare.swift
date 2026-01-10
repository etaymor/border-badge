/**
 * QueuedShare - Offline queue item for pending shares
 *
 * Stores share data when the user is offline or unauthenticated,
 * to be processed when conditions allow.
 */

import Foundation

struct QueuedShare: Codable, Identifiable, Equatable {
    let id: String
    let url: String
    let caption: String?
    let timestamp: Date
    var attemptCount: Int

    /// Reason the share was queued
    let reason: QueueReason

    /// Optional ingest result if we got that far
    let ingestResult: SocialIngestResponse?

    /// Optional user-selected data if we got that far
    let selectedTripId: String?
    let selectedPlace: SelectedPlace?
    let entryType: EntryType?
    let notes: String?

    enum QueueReason: String, Codable {
        case unauthenticated
        case networkError
        case serverError
        case timeout
    }

    /// Create a new queued share from a URL
    init(
        url: String,
        caption: String? = nil,
        reason: QueueReason,
        ingestResult: SocialIngestResponse? = nil,
        selectedTripId: String? = nil,
        selectedPlace: SelectedPlace? = nil,
        entryType: EntryType? = nil,
        notes: String? = nil
    ) {
        self.id = UUID().uuidString
        self.url = url
        self.caption = caption
        self.timestamp = Date()
        self.attemptCount = 0
        self.reason = reason
        self.ingestResult = ingestResult
        self.selectedTripId = selectedTripId
        self.selectedPlace = selectedPlace
        self.entryType = entryType
        self.notes = notes
    }

    /// Check if the share should be retried based on attempt count and age
    var shouldRetry: Bool {
        // Max 3 retry attempts
        guard attemptCount < 3 else { return false }

        // Don't retry items older than 7 days
        let maxAge: TimeInterval = 7 * 24 * 60 * 60
        guard Date().timeIntervalSince(timestamp) < maxAge else { return false }

        return true
    }

    /// Create a copy with incremented attempt count
    func incrementingAttempt() -> QueuedShare {
        var copy = self
        copy.attemptCount += 1
        return copy
    }
}

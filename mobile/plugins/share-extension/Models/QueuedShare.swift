//
// QueuedShare.swift
// Offline queue item for pending shares (extension + main app decode)
//

import Foundation

struct QueuedShare: Codable, Identifiable, Equatable {
    let id: String
    let url: String
    let caption: String?
    let timestamp: Date

    /// Reason the share was queued
    let reason: QueueReason

    /// Optional ingest result if we got that far
    let ingestResult: SocialIngestResponse?

    /// Optional user-selected data if we got that far
    let selectedTripId: String?
    let selectedPlace: DetectedPlace?
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
        selectedPlace: DetectedPlace? = nil,
        entryType: EntryType? = nil,
        notes: String? = nil
    ) {
        self.id = UUID().uuidString
        self.url = url
        self.caption = caption
        self.timestamp = Date()
        self.reason = reason
        self.ingestResult = ingestResult
        self.selectedTripId = selectedTripId
        self.selectedPlace = selectedPlace
        self.entryType = entryType
        self.notes = notes
    }

    /// Check if the share is still valid (not expired)
    var isValid: Bool {
        // Don't process items older than 7 days
        let maxAge: TimeInterval = 7 * 24 * 60 * 60
        return Date().timeIntervalSince(timestamp) < maxAge
    }
}

/**
 * OfflineQueueService - Manages offline share queue
 *
 * Stores failed/pending shares for later processing by the main app.
 */

import Foundation

enum OfflineQueueService {
    /// Add a URL to the offline queue
    static func queueShare(
        url: String,
        caption: String? = nil,
        reason: QueuedShare.QueueReason,
        ingestResult: SocialIngestResponse? = nil,
        selectedTripId: String? = nil,
        selectedPlace: SelectedPlace? = nil,
        entryType: EntryType? = nil,
        notes: String? = nil
    ) {
        let share = QueuedShare(
            url: url,
            caption: caption,
            reason: reason,
            ingestResult: ingestResult,
            selectedTripId: selectedTripId,
            selectedPlace: selectedPlace,
            entryType: entryType,
            notes: notes
        )

        AppGroupStorage.addToOfflineQueue(share)
        NSLog("[Atlasi OfflineQueue] Queued share: \(url) reason: \(reason.rawValue)")
    }

    /// Get the current queue
    static func getQueue() -> [QueuedShare] {
        AppGroupStorage.getOfflineQueue()
    }

    /// Get count of pending shares
    static var pendingCount: Int {
        getQueue().filter { $0.shouldRetry }.count
    }

    /// Check if there are pending shares
    static var hasPendingShares: Bool {
        pendingCount > 0
    }

    /// Remove a share from the queue (after successful processing)
    static func removeShare(id: String) {
        AppGroupStorage.removeFromOfflineQueue(id: id)
    }

    /// Clear expired shares from the queue
    static func cleanupExpiredShares() {
        var queue = getQueue()
        let beforeCount = queue.count

        queue.removeAll { !$0.shouldRetry }

        if queue.count != beforeCount {
            AppGroupStorage.saveOfflineQueue(queue)
            NSLog("[Atlasi OfflineQueue] Cleaned up \(beforeCount - queue.count) expired shares")
        }
    }

    /// Update a share's attempt count
    static func incrementAttempt(id: String) {
        var queue = getQueue()
        if let index = queue.firstIndex(where: { $0.id == id }) {
            queue[index] = queue[index].incrementingAttempt()
            AppGroupStorage.saveOfflineQueue(queue)
        }
    }

    /// Clear the entire queue
    static func clearQueue() {
        AppGroupStorage.clearOfflineQueue()
    }
}

/**
 * OfflineQueueService - Manages offline share queue (Swift/iOS Extension)
 *
 * Stores failed/pending shares for later processing by the main app.
 *
 * ============================================================================
 * IMPORTANT: DUAL QUEUE SYSTEM LIMITATION
 * ============================================================================
 *
 * There are TWO separate offline queue systems in this app:
 *
 * 1. **This Swift queue** - Uses App Group UserDefaults, accessible from iOS extensions
 *    - Location: mobile/plugins/share-extension/Services/OfflineQueueService.swift (this file)
 *    - Storage: App Group UserDefaults (group.com.taymor.atlasi)
 *    - Used by: iOS Share Extension when shares fail or need user input
 *
 * 2. **TypeScript queue** - Uses AsyncStorage, accessible from React Native
 *    - Location: mobile/src/services/shareQueue.ts
 *    - Storage: AsyncStorage with key 'share_queue'
 *    - Used by: Main React Native app for retry logic
 *
 * These queues DO NOT communicate with each other. Items queued here (Swift)
 * are stored in App Group UserDefaults, which React Native cannot read directly.
 *
 * CURRENT BEHAVIOR:
 * - Items queued here may not be automatically processed by the main app
 * - The main app has its own queue in AsyncStorage for its retry logic
 *
 * TODO: Implement native bridge to sync this queue to the TypeScript queue
 * This requires adding `react-native-shared-group-preferences` or a custom
 * native module to read App Group UserDefaults from React Native.
 * See: todos/014-ready-p2-dual-queue-systems.md
 * ============================================================================
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
        selectedPlace: DetectedPlace? = nil,
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
        getQueue().filter { $0.isValid }.count
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

        queue.removeAll { !$0.isValid }

        if queue.count != beforeCount {
            AppGroupStorage.saveOfflineQueue(queue)
            NSLog("[Atlasi OfflineQueue] Cleaned up \(beforeCount - queue.count) expired shares")
        }
    }

    /// Clear the entire queue
    static func clearQueue() {
        AppGroupStorage.clearOfflineQueue()
    }
}

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
 *    - Storage: App Group UserDefaults (group.com.atlasi.app)
 *    - Used by: iOS Share Extension when shares fail or need user input
 *
 * 2. **TypeScript queue** - Uses AsyncStorage, accessible from React Native
 *    - Location: mobile/src/services/shareQueue.ts
 *    - Storage: AsyncStorage with key 'share_queue'
 *    - Used by: Main React Native app for retry logic
 *
 * These queues now communicate via the SharedGroupPreferences native module.
 * The main app syncs this Swift queue to its AsyncStorage queue on every
 * app foreground via syncOfflineQueueFromExtension() in shareExtensionBridge.ts.
 *
 * CURRENT BEHAVIOR:
 * - Items queued here are synced to the TypeScript queue when the main app foregrounds
 * - The main app's retry logic processes all queued items (from both queues)
 * ============================================================================
 */

import Foundation

enum OfflineQueueService {
    /// Serial queue for synchronizing all offline queue access within this process.
    /// Prevents race conditions from concurrent calls to queue operations.
    /// Note: This does NOT protect against cross-process races (see AppGroupStorage docs).
    private static let queueAccessQueue = DispatchQueue(label: "com.atlasi.offlinequeue.access")

    /// Add a URL to the offline queue
    /// - Returns: True if the share was successfully queued, false if storage failed
    @discardableResult
    static func queueShare(
        url: String,
        caption: String? = nil,
        reason: QueuedShare.QueueReason,
        ingestResult: SocialIngestResponse? = nil,
        selectedTripId: String? = nil,
        selectedPlace: DetectedPlace? = nil,
        entryType: EntryType? = nil,
        notes: String? = nil
    ) -> Bool {
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

        let success = queueAccessQueue.sync {
            AppGroupStorage.addToOfflineQueue(share)
        }
        if success {
            NSLog("[Atlasi OfflineQueue] Queued share: \(url) reason: \(reason.rawValue)")
        } else {
            NSLog("[Atlasi OfflineQueue] Failed to queue share: \(url)")
        }
        return success
    }

    /// Get the current queue
    static func getQueue() -> [QueuedShare] {
        queueAccessQueue.sync {
            AppGroupStorage.getOfflineQueue()
        }
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
        queueAccessQueue.sync {
            AppGroupStorage.removeFromOfflineQueue(id: id)
        }
    }

    /// Clear expired shares from the queue
    static func cleanupExpiredShares() {
        queueAccessQueue.sync {
            var queue = AppGroupStorage.getOfflineQueue()
            let beforeCount = queue.count

            queue.removeAll { !$0.isValid }

            if queue.count != beforeCount {
                AppGroupStorage.saveOfflineQueue(queue)
                NSLog("[Atlasi OfflineQueue] Cleaned up \(beforeCount - queue.count) expired shares")
            }
        }
    }

    /// Clear the entire queue
    static func clearQueue() {
        queueAccessQueue.sync {
            AppGroupStorage.clearOfflineQueue()
        }
    }
}

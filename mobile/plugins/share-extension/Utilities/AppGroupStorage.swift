/**
 * AppGroupStorage - Shared UserDefaults wrapper for App Group storage
 *
 * Provides read/write access to the shared App Group container used by
 * both the main app and share extension.
 *
 * ## Concurrency Limitation (MVP)
 *
 * The offline queue operations (read-modify-write) in this file are NOT atomic.
 * Concurrent access from the share extension and main app could result in data loss.
 *
 * **Race Condition Scenario:**
 * 1. Share extension reads queue: `[A, B]`
 * 2. Main app reads queue: `[A, B]`
 * 3. Share extension adds C, writes: `[A, B, C]`
 * 4. Main app removes A, writes: `[B]` - Share C is lost!
 *
 * **Why this is acceptable for MVP:**
 * - The share extension is the primary writer (adding new shares)
 * - The main app is the primary reader (syncing shares to server)
 * - Main app only modifies queue after successful sync (removing items)
 * - Users rarely share while the main app is actively syncing
 * - Worst case: a share is lost, user can re-share
 *
 * **Future Improvement:**
 * Implement `NSFileCoordinator` for atomic cross-process access:
 * ```swift
 * let coordinator = NSFileCoordinator()
 * coordinator.coordinate(writingItemAt: queueFileURL, options: .forMerging, error: &error) { url in
 *     // Atomic read-modify-write here
 * }
 * ```
 *
 * See: https://developer.apple.com/documentation/foundation/nsfilecoordinator
 */

import Foundation

enum AppGroupStorage {
    /// App Group identifier
    private static let appGroupID = "group.com.atlasi.app"

    // MARK: - Keys

    /// Key for the shared URL from share extension
    static let sharedURLKey = "SharedURL"

    /// Key for the timestamp when URL was shared
    static let timestampKey = "SharedURLTimestamp"

    /// Key for the offline queue of failed/pending shares
    static let offlineQueueKey = "OfflineShareQueue"

    /// Key for sharing extension state with main app
    static let extensionStateKey = "ShareExtensionState"

    /// Key for tracking if user has ever used the share extension (read by main app for tutorial)
    static let hasUsedShareExtensionKey = "hasUsedShareExtension"

    // MARK: - UserDefaults Access

    /// Get the shared UserDefaults for the App Group
    static var userDefaults: UserDefaults? {
        UserDefaults(suiteName: appGroupID)
    }

    // MARK: - URL Sharing

    /// Save a URL to be processed by the main app
    static func saveSharedURL(_ url: String) -> Bool {
        guard let defaults = userDefaults else {
            NSLog("[Atlasi AppGroupStorage] Failed to access App Group: \(appGroupID)")
            return false
        }

        defaults.set(url, forKey: sharedURLKey)
        defaults.set(Date().timeIntervalSince1970, forKey: timestampKey)
        return true
    }

    /// Get the shared URL if one exists
    static func getSharedURL() -> String? {
        return userDefaults?.string(forKey: sharedURLKey)
    }

    /// Get the timestamp when the URL was shared
    static func getSharedURLTimestamp() -> Date? {
        guard let timestamp = userDefaults?.double(forKey: timestampKey),
              timestamp > 0 else {
            return nil
        }
        return Date(timeIntervalSince1970: timestamp)
    }

    /// Clear the shared URL
    static func clearSharedURL() {
        userDefaults?.removeObject(forKey: sharedURLKey)
        userDefaults?.removeObject(forKey: timestampKey)
    }

    // MARK: - Generic Access

    /// Read a string value
    static func getString(_ key: String) -> String? {
        return userDefaults?.string(forKey: key)
    }

    /// Write a string value
    static func setString(_ key: String, value: String) {
        userDefaults?.set(value, forKey: key)
    }

    /// Read data
    static func getData(_ key: String) -> Data? {
        return userDefaults?.data(forKey: key)
    }

    /// Write data
    static func setData(_ key: String, value: Data) {
        userDefaults?.set(value, forKey: key)
    }

    /// Remove a value
    static func remove(_ key: String) {
        userDefaults?.removeObject(forKey: key)
    }

    // MARK: - Offline Queue
    // MARK: - Concurrency Limitation
    //
    // WARNING: The queue operations below use a read-modify-write pattern that is NOT atomic.
    // Concurrent access from the share extension and main app could cause data loss.
    //
    // This is acceptable for MVP because:
    // - Share extension writes (adds items), main app reads (syncs to server)
    // - Main app only removes items after successful sync
    // - Concurrent modification is rare in practice
    //
    // NOTE: For production, consider wrapping queue operations with NSFileCoordinator for atomic access.
    // See file header documentation for implementation details.

    /// Get the offline share queue
    static func getOfflineQueue() -> [QueuedShare] {
        guard let data = getData(offlineQueueKey),
              let queue = try? JSONDecoder().decode([QueuedShare].self, from: data) else {
            return []
        }
        return queue
    }

    /// Save the offline share queue
    @discardableResult
    static func saveOfflineQueue(_ queue: [QueuedShare]) -> Bool {
        guard let data = try? JSONEncoder().encode(queue) else {
            NSLog("[Atlasi AppGroupStorage] Failed to encode offline queue")
            return false
        }
        setData(offlineQueueKey, value: data)
        return true
    }

    /// Add a share to the offline queue
    /// - Note: This operation is not atomic. See Concurrency Limitation comment above.
    /// - Returns: True if the share was successfully added, false if storage failed
    @discardableResult
    static func addToOfflineQueue(_ share: QueuedShare) -> Bool {
        // Read-modify-write: potential race condition with concurrent access
        var queue = getOfflineQueue()    // Read
        queue.append(share)              // Modify

        // Keep only newest 50 items
        let maxQueueSize = 50
        if queue.count > maxQueueSize {
            let evictedCount = queue.count - maxQueueSize
            NSLog("[Atlasi AppGroupStorage] Queue size exceeded, evicting \(evictedCount) oldest items")
            queue = Array(queue.suffix(maxQueueSize))
        }

        return saveOfflineQueue(queue)          // Write - may overwrite concurrent changes
    }

    /// Remove a share from the offline queue
    /// - Note: This operation is not atomic. See Concurrency Limitation comment above.
    static func removeFromOfflineQueue(id: String) {
        // Read-modify-write: potential race condition with concurrent access
        var queue = getOfflineQueue()    // Read
        queue.removeAll { $0.id == id }  // Modify
        saveOfflineQueue(queue)          // Write - may overwrite concurrent changes
    }

    /// Clear the entire offline queue
    static func clearOfflineQueue() {
        remove(offlineQueueKey)
    }

    // MARK: - Share Extension Usage Tracking

    /// Mark that the user has successfully used the share extension
    /// Called after a successful save to inform the main app (for tutorial dismissal)
    static func markShareExtensionUsed() {
        userDefaults?.set(true, forKey: hasUsedShareExtensionKey)
    }

    /// Check if the user has ever used the share extension
    static func hasUsedShareExtension() -> Bool {
        return userDefaults?.bool(forKey: hasUsedShareExtensionKey) ?? false
    }
}

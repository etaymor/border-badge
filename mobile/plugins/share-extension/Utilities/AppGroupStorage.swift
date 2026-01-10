/**
 * AppGroupStorage - Shared UserDefaults wrapper for App Group storage
 *
 * Provides read/write access to the shared App Group container used by
 * both the main app and share extension.
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

    /// Get the offline share queue
    static func getOfflineQueue() -> [QueuedShare] {
        guard let data = getData(offlineQueueKey),
              let queue = try? JSONDecoder().decode([QueuedShare].self, from: data) else {
            return []
        }
        return queue
    }

    /// Save the offline share queue
    static func saveOfflineQueue(_ queue: [QueuedShare]) {
        guard let data = try? JSONEncoder().encode(queue) else {
            NSLog("[Atlasi AppGroupStorage] Failed to encode offline queue")
            return
        }
        setData(offlineQueueKey, value: data)
    }

    /// Add a share to the offline queue
    static func addToOfflineQueue(_ share: QueuedShare) {
        var queue = getOfflineQueue()
        queue.append(share)
        saveOfflineQueue(queue)
    }

    /// Remove a share from the offline queue
    static func removeFromOfflineQueue(id: String) {
        var queue = getOfflineQueue()
        queue.removeAll { $0.id == id }
        saveOfflineQueue(queue)
    }

    /// Clear the entire offline queue
    static func clearOfflineQueue() {
        remove(offlineQueueKey)
    }
}

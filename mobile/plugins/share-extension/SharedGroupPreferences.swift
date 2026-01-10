/**
 * SharedGroupPreferences - Native Module for App Group UserDefaults
 *
 * This module allows React Native to read/write data from the App Group
 * shared between the main app and the Share Extension.
 */

import Foundation
import React

@objc(SharedGroupPreferences)
class SharedGroupPreferences: NSObject {

    /// App Group identifier
    private let appGroupID = "group.com.atlasi.app"

    @objc
    static func requiresMainQueueSetup() -> Bool {
        return false
    }

    /// Get a string value from App Group UserDefaults
    @objc
    func getItem(_ key: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let userDefaults = UserDefaults(suiteName: appGroupID) else {
            resolve(nil)
            return
        }

        let value = userDefaults.string(forKey: key)
        resolve(value)
    }

    /// Set a string value in App Group UserDefaults
    @objc
    func setItem(_ key: String, value: String?, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let userDefaults = UserDefaults(suiteName: appGroupID) else {
            reject("ERROR", "Could not access App Group", nil)
            return
        }

        if let value = value {
            userDefaults.set(value, forKey: key)
        } else {
            userDefaults.removeObject(forKey: key)
        }
        resolve(nil)
    }

    /// Get the timestamp when the shared URL was saved
    @objc
    func getTimestamp(_ key: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let userDefaults = UserDefaults(suiteName: appGroupID) else {
            resolve(nil)
            return
        }

        let timestamp = userDefaults.double(forKey: key)
        if timestamp > 0 {
            resolve(timestamp)
        } else {
            resolve(nil)
        }
    }

    /// Clear all shared data
    @objc
    func clearAll(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let userDefaults = UserDefaults(suiteName: appGroupID) else {
            resolve(nil)
            return
        }

        userDefaults.removeObject(forKey: "SharedURL")
        userDefaults.removeObject(forKey: "SharedURLTimestamp")
        resolve(nil)
    }

    /// Get the offline share queue from App Group UserDefaults
    /// Returns JSON string with queue items, or nil if empty/unavailable
    @objc
    func getOfflineQueue(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let userDefaults = UserDefaults(suiteName: appGroupID) else {
            resolve(nil)
            return
        }

        guard let data = userDefaults.data(forKey: "OfflineShareQueue") else {
            resolve(nil)
            return
        }

        // Decode the Swift queue format
        let decoder = JSONDecoder()
        guard let shares = try? decoder.decode([QueuedShare].self, from: data) else {
            // Could not decode, queue may be corrupted or empty
            resolve(nil)
            return
        }

        // Convert to JS-compatible format
        // Swift Date default encoding is seconds since reference date (Jan 1, 2001)
        // JS expects milliseconds since epoch (Jan 1, 1970)
        let jsShares = shares.map { share -> [String: Any?] in
            // Convert Swift Date to JS milliseconds since epoch
            let timestampMs = share.timestamp.timeIntervalSince1970 * 1000

            return [
                "id": share.id,
                "url": share.url,
                "caption": share.caption,
                "timestamp": timestampMs,
                "reason": share.reason.rawValue,
                "selectedTripId": share.selectedTripId,
                "entryType": share.entryType?.rawValue,
                "notes": share.notes
            ]
        }

        // Serialize to JSON string for React Native
        guard let jsonData = try? JSONSerialization.data(withJSONObject: jsShares),
              let jsonString = String(data: jsonData, encoding: .utf8) else {
            resolve(nil)
            return
        }

        resolve(jsonString)
    }

    /// Clear the offline share queue from App Group UserDefaults
    @objc
    func clearOfflineQueue(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let userDefaults = UserDefaults(suiteName: appGroupID) else {
            resolve(nil)
            return
        }

        userDefaults.removeObject(forKey: "OfflineShareQueue")
        resolve(nil)
    }
}

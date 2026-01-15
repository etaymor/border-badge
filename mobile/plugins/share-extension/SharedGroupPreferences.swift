/**
 * SharedGroupPreferences - Native Module for App Group UserDefaults
 *
 * This module allows React Native to read/write data from the App Group
 * shared between the main app and the Share Extension.
 */

import Foundation
import React

// MARK: - Analytics Types (duplicated for main app target)
// These types are also defined in Services/AnalyticsQueue.swift for the ShareExtension target.
// They must be kept in sync. See scripts/validate-model-sync.js for validation.

/// Analytics event from the Share Extension queue
private struct AnalyticsEvent: Codable, Identifiable {
    let id: String
    let event: String
    let properties: [String: AnyCodable]?
    let timestamp: Date

    var isValid: Bool {
        let maxAge: TimeInterval = 7 * 24 * 60 * 60
        return Date().timeIntervalSince(timestamp) < maxAge
    }
}

/// Type-erased Codable wrapper for analytics properties
private struct AnyCodable: Codable {
    let value: Any

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if container.decodeNil() {
            value = NSNull()
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported type")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case let bool as Bool: try container.encode(bool)
        case let int as Int: try container.encode(int)
        case let double as Double: try container.encode(double)
        case let string as String: try container.encode(string)
        case is NSNull: try container.encodeNil()
        default: try container.encode(String(describing: value))
        }
    }
}

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
        // Use [String: Any] with NSNull() for nil values to ensure JSON serialization works
        let jsShares: [[String: Any]] = shares.map { share in
            // Convert Swift Date to JS milliseconds since epoch
            let timestampMs: Double = share.timestamp.timeIntervalSince1970 * 1000

            var dict: [String: Any] = [
                "id": share.id,
                "url": share.url,
                "timestamp": timestampMs,
                "reason": share.reason.rawValue
            ]

            // Add optional fields with NSNull() for nil values
            dict["caption"] = share.caption ?? NSNull()
            dict["selectedTripId"] = share.selectedTripId ?? NSNull()
            dict["entryType"] = share.entryType?.rawValue ?? NSNull()
            dict["notes"] = share.notes ?? NSNull()

            return dict
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

    // MARK: - Analytics Queue

    /// Get the analytics queue from App Group UserDefaults
    /// Returns JSON string with analytics events, or nil if empty/unavailable
    @objc
    func getAnalyticsQueue(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let userDefaults = UserDefaults(suiteName: appGroupID) else {
            resolve(nil)
            return
        }

        guard let data = userDefaults.data(forKey: "AnalyticsQueue") else {
            resolve(nil)
            return
        }

        // Decode the Swift analytics events
        let decoder = JSONDecoder()
        guard let events = try? decoder.decode([AnalyticsEvent].self, from: data) else {
            // Could not decode, queue may be corrupted or empty
            resolve(nil)
            return
        }

        // Filter out expired events
        let validEvents = events.filter { $0.isValid }

        // Convert to JS-compatible format
        let jsEvents: [[String: Any]] = validEvents.map { event in
            // Convert Swift Date to JS milliseconds since epoch
            let timestampMs: Double = event.timestamp.timeIntervalSince1970 * 1000

            var dict: [String: Any] = [
                "id": event.id,
                "event": event.event,
                "timestamp": timestampMs
            ]

            // Convert properties if present
            if let properties = event.properties {
                var jsProps: [String: Any] = [:]
                for (key, value) in properties {
                    jsProps[key] = value.value
                }
                dict["properties"] = jsProps
            }

            return dict
        }

        // Serialize to JSON string for React Native
        guard let jsonData = try? JSONSerialization.data(withJSONObject: jsEvents),
              let jsonString = String(data: jsonData, encoding: .utf8) else {
            resolve(nil)
            return
        }

        resolve(jsonString)
    }

    /// Clear the analytics queue from App Group UserDefaults
    @objc
    func clearAnalyticsQueue(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let userDefaults = UserDefaults(suiteName: appGroupID) else {
            resolve(nil)
            return
        }

        userDefaults.removeObject(forKey: "AnalyticsQueue")
        resolve(nil)
    }

    // MARK: - Share Extension Usage Tracking

    /// Check if user has ever used the share extension successfully
    /// Returns true if they have, false otherwise
    @objc
    func getHasUsedShareExtension(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let userDefaults = UserDefaults(suiteName: appGroupID) else {
            resolve(false)
            return
        }

        let hasUsed = userDefaults.bool(forKey: "hasUsedShareExtension")
        resolve(hasUsed)
    }
}

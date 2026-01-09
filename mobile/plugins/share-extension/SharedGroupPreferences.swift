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
}

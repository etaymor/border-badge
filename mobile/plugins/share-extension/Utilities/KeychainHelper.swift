/**
 * KeychainHelper - Secure storage access for share extension
 *
 * Reads JWT tokens from the shared Keychain group to authenticate API requests.
 * The main app writes tokens to Keychain via expo-secure-store.
 */

import Foundation
import Security

enum KeychainHelper {
    /// Keychain service identifier used by expo-secure-store
    /// IMPORTANT: expo-secure-store appends ":no-auth" or ":auth" suffix based on requireAuthentication option
    /// Since the main app stores tokens without requireAuthentication (defaults to false), it uses "app:no-auth"
    /// See: node_modules/expo-secure-store/ios/SecureStoreModule.swift lines 173-176
    private static let service = "app:no-auth"

    /// Key for the JWT access token
    private static let tokenKey = "auth_token"

    /// Key for the refresh token
    private static let refreshTokenKey = "refresh_token"

    /// Keychain access group for sharing between app and extension
    /// Format: <TeamID>.<BundleIdentifier>
    ///
    /// This must match the keychain-access-groups entry in both:
    /// - ShareExtension.entitlements (as $(AppIdentifierPrefix)com.atlasi.app)
    /// - Main app entitlements (configured in withShareExtension.js)
    ///
    /// The main app must also use this access group when storing tokens.
    /// See: docs/ios-share-extension.md for configuration details.
    ///
    /// Team ID: 2AB5M8J3G6 (from eas.json submit.production.ios.appleTeamId)
    private static let accessGroup: String? = "2AB5M8J3G6.com.atlasi.app"

    // MARK: - Public API

    /// Retrieve the JWT access token from Keychain
    /// - Returns: The token string, or nil if not found or expired
    static func getToken() -> String? {
        return read(key: tokenKey)
    }

    /// Retrieve the refresh token from Keychain
    /// - Returns: The refresh token string, or nil if not found
    static func getRefreshToken() -> String? {
        return read(key: refreshTokenKey)
    }

    /// Check if a valid token exists
    /// - Returns: True if a token is stored (doesn't validate expiration)
    static var hasToken: Bool { getToken() != nil }

    // MARK: - Private Helpers

    /// Read a value from Keychain
    private static func read(key: String) -> String? {
        var query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: key,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne
        ]

        // Add access group if configured
        if let group = accessGroup {
            query[kSecAttrAccessGroup] = group
        }

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess,
              let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else {
            if status != errSecItemNotFound {
                NSLog("[Atlasi KeychainHelper] Read failed for key \(key): \(status)")
            }
            return nil
        }

        return value
    }

    /// Write a value to Keychain (for future use if needed)
    static func write(key: String, value: String) -> Bool {
        guard let data = value.data(using: .utf8) else { return false }

        // First try to update existing item
        var query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: key
        ]

        if let group = accessGroup {
            query[kSecAttrAccessGroup] = group
        }

        let attributes: [CFString: Any] = [
            kSecValueData: data
        ]

        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)

        if status == errSecItemNotFound {
            // Item doesn't exist, add it
            query[kSecValueData] = data
            query[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlock
            status = SecItemAdd(query as CFDictionary, nil)
        }

        if status != errSecSuccess {
            NSLog("[Atlasi KeychainHelper] Write failed for key \(key): \(status)")
            return false
        }

        return true
    }

    /// Delete a value from Keychain
    static func delete(key: String) -> Bool {
        var query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: key
        ]

        if let group = accessGroup {
            query[kSecAttrAccessGroup] = group
        }

        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }
}

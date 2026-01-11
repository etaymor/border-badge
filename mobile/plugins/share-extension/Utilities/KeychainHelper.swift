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
        let result = read(key: tokenKey)
        NSLog("[Atlasi KeychainHelper] getToken: %@, service=%@, group=%@",
              result != nil ? "FOUND" : "NOT_FOUND",
              service,
              accessGroup ?? "nil")
        return result
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
    /// IMPORTANT: Must match expo-secure-store's query format exactly.
    /// expo-secure-store uses Data(key.utf8) for both kSecAttrGeneric and kSecAttrAccount.
    /// See: node_modules/expo-secure-store/ios/SecureStoreModule.swift lines 178-185
    private static func read(key: String) -> String? {
        // expo-secure-store encodes the key as Data, not String
        let encodedKey = Data(key.utf8)

        var query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrGeneric: encodedKey,    // Must match expo-secure-store
            kSecAttrAccount: encodedKey,    // Must be Data, not String
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
            // Log all failures including errSecItemNotFound (-25300) for debugging
            NSLog("[Atlasi KeychainHelper] Read failed: key=%@, status=%d (%@)",
                  key,
                  status,
                  status == errSecItemNotFound ? "errSecItemNotFound" :
                  status == errSecAuthFailed ? "errSecAuthFailed" :
                  status == errSecMissingEntitlement ? "errSecMissingEntitlement" : "unknown")
            return nil
        }

        return value
    }

    /// Write a value to Keychain (for future use if needed)
    /// IMPORTANT: Must match expo-secure-store's query format for consistency.
    static func write(key: String, value: String) -> Bool {
        guard let valueData = value.data(using: .utf8) else { return false }

        // expo-secure-store encodes the key as Data, not String
        let encodedKey = Data(key.utf8)

        // First try to update existing item
        var query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrGeneric: encodedKey,    // Must match expo-secure-store
            kSecAttrAccount: encodedKey     // Must be Data, not String
        ]

        if let group = accessGroup {
            query[kSecAttrAccessGroup] = group
        }

        let attributes: [CFString: Any] = [
            kSecValueData: valueData
        ]

        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)

        if status == errSecItemNotFound {
            // Item doesn't exist, add it
            query[kSecValueData] = valueData
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
    /// IMPORTANT: Must match expo-secure-store's query format for consistency.
    static func delete(key: String) -> Bool {
        // expo-secure-store encodes the key as Data, not String
        let encodedKey = Data(key.utf8)

        var query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrGeneric: encodedKey,    // Must match expo-secure-store
            kSecAttrAccount: encodedKey     // Must be Data, not String
        ]

        if let group = accessGroup {
            query[kSecAttrAccessGroup] = group
        }

        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }
}

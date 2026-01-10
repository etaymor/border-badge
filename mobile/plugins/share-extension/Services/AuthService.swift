/**
 * AuthService - Authentication state management for share extension
 *
 * Checks if the user is authenticated and handles session state.
 */

import Foundation

enum AuthState {
    case authenticated
    case unauthenticated
    case expired
}

enum AuthService {
    /// Check the current authentication state
    static func checkAuthState() -> AuthState {
        guard let token = KeychainHelper.getToken() else {
            return .unauthenticated
        }

        // Check if token is expired by decoding JWT payload
        if isTokenExpired(token) {
            return .expired
        }

        return .authenticated
    }

    /// Check if user is authenticated
    static var isAuthenticated: Bool {
        checkAuthState() == .authenticated
    }

    /// Get the current JWT token if valid
    static func getValidToken() -> String? {
        guard let token = KeychainHelper.getToken(),
              !isTokenExpired(token) else {
            return nil
        }
        return token
    }

    // MARK: - Private Helpers

    /// Decode and check JWT expiration
    /// JWT format: header.payload.signature (base64url encoded)
    private static func isTokenExpired(_ token: String) -> Bool {
        let parts = token.split(separator: ".")
        guard parts.count == 3 else {
            return true
        }

        // Decode the payload (second part)
        var payload = String(parts[1])

        // Fix base64url padding
        while payload.count % 4 != 0 {
            payload += "="
        }

        // Convert base64url to base64
        payload = payload
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")

        guard let data = Data(base64Encoded: payload),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let exp = json["exp"] as? TimeInterval else {
            // If we can't decode, assume valid and let server handle it
            return false
        }

        // Check expiration with 60 second buffer
        let expirationDate = Date(timeIntervalSince1970: exp)
        return Date().addingTimeInterval(60) > expirationDate
    }
}

/**
 * KeychainHelperTests - Unit tests for KeychainHelper
 *
 * Tests secure storage operations for the share extension.
 * Note: These tests use a test-specific keychain service to avoid
 * interfering with production keychain data.
 */

import XCTest
@testable import ShareExtension

final class KeychainHelperTests: XCTestCase {

    // MARK: - Test Lifecycle

    override func setUp() {
        super.setUp()
        // Clean up any test data before each test
        _ = KeychainHelper.delete(key: "auth_token")
        _ = KeychainHelper.delete(key: "refresh_token")
        _ = KeychainHelper.delete(key: "test_key")
    }

    override func tearDown() {
        // Clean up test data after each test
        _ = KeychainHelper.delete(key: "auth_token")
        _ = KeychainHelper.delete(key: "refresh_token")
        _ = KeychainHelper.delete(key: "test_key")
        super.tearDown()
    }

    // MARK: - Read Tests

    func testGetTokenReturnsNilWhenNotSet() {
        // Given: No token in keychain

        // When
        let token = KeychainHelper.getToken()

        // Then
        XCTAssertNil(token, "getToken should return nil when no token is stored")
    }

    func testGetRefreshTokenReturnsNilWhenNotSet() {
        // Given: No refresh token in keychain

        // When
        let refreshToken = KeychainHelper.getRefreshToken()

        // Then
        XCTAssertNil(refreshToken, "getRefreshToken should return nil when no token is stored")
    }

    func testHasTokenReturnsFalseWhenNoToken() {
        // Given: No token in keychain

        // When
        let hasToken = KeychainHelper.hasToken

        // Then
        XCTAssertFalse(hasToken, "hasToken should be false when no token is stored")
    }

    // MARK: - Write Tests

    func testWriteAndReadToken() {
        // Given
        let testToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test"

        // When
        let writeSuccess = KeychainHelper.write(key: "auth_token", value: testToken)
        let readToken = KeychainHelper.getToken()

        // Then
        XCTAssertTrue(writeSuccess, "write should succeed")
        XCTAssertEqual(readToken, testToken, "getToken should return the written token")
    }

    func testWriteAndReadRefreshToken() {
        // Given
        let testRefreshToken = "refresh-token-abc123"

        // When
        let writeSuccess = KeychainHelper.write(key: "refresh_token", value: testRefreshToken)
        let readToken = KeychainHelper.getRefreshToken()

        // Then
        XCTAssertTrue(writeSuccess, "write should succeed")
        XCTAssertEqual(readToken, testRefreshToken, "getRefreshToken should return the written token")
    }

    func testHasTokenReturnsTrueAfterWrite() {
        // Given
        let testToken = "test-token-123"

        // When
        _ = KeychainHelper.write(key: "auth_token", value: testToken)

        // Then
        XCTAssertTrue(KeychainHelper.hasToken, "hasToken should be true after writing token")
    }

    func testWriteUpdatesExistingValue() {
        // Given
        let originalToken = "original-token"
        let updatedToken = "updated-token"
        _ = KeychainHelper.write(key: "auth_token", value: originalToken)

        // When
        let updateSuccess = KeychainHelper.write(key: "auth_token", value: updatedToken)
        let readToken = KeychainHelper.getToken()

        // Then
        XCTAssertTrue(updateSuccess, "update should succeed")
        XCTAssertEqual(readToken, updatedToken, "getToken should return the updated token")
    }

    func testWriteHandlesEmptyString() {
        // Given
        let emptyValue = ""

        // When
        let writeSuccess = KeychainHelper.write(key: "test_key", value: emptyValue)

        // Then
        XCTAssertTrue(writeSuccess, "write should succeed even with empty string")
    }

    func testWriteHandlesSpecialCharacters() {
        // Given
        let specialToken = "token+with/special=chars&more!@#$%"

        // When
        let writeSuccess = KeychainHelper.write(key: "auth_token", value: specialToken)
        let readToken = KeychainHelper.getToken()

        // Then
        XCTAssertTrue(writeSuccess, "write should handle special characters")
        XCTAssertEqual(readToken, specialToken, "read should return token with special characters")
    }

    func testWriteHandlesUnicode() {
        // Given
        let unicodeToken = "token-with-unicode-\u{1F600}-emoji"

        // When
        let writeSuccess = KeychainHelper.write(key: "auth_token", value: unicodeToken)
        let readToken = KeychainHelper.getToken()

        // Then
        XCTAssertTrue(writeSuccess, "write should handle unicode characters")
        XCTAssertEqual(readToken, unicodeToken, "read should return token with unicode")
    }

    // MARK: - Delete Tests

    func testDeleteRemovesValue() {
        // Given
        _ = KeychainHelper.write(key: "auth_token", value: "token-to-delete")
        XCTAssertNotNil(KeychainHelper.getToken(), "precondition: token should exist")

        // When
        let deleteSuccess = KeychainHelper.delete(key: "auth_token")
        let readToken = KeychainHelper.getToken()

        // Then
        XCTAssertTrue(deleteSuccess, "delete should succeed")
        XCTAssertNil(readToken, "token should be nil after deletion")
    }

    func testDeleteReturnsTrueForNonexistentKey() {
        // Given: Key does not exist

        // When
        let deleteResult = KeychainHelper.delete(key: "nonexistent_key")

        // Then
        // Keychain delete returns true for both successful delete and key not found
        XCTAssertTrue(deleteResult, "delete should return true for nonexistent key (errSecItemNotFound)")
    }

    func testHasTokenReturnsFalseAfterDelete() {
        // Given
        _ = KeychainHelper.write(key: "auth_token", value: "token-to-delete")
        XCTAssertTrue(KeychainHelper.hasToken, "precondition: hasToken should be true")

        // When
        _ = KeychainHelper.delete(key: "auth_token")

        // Then
        XCTAssertFalse(KeychainHelper.hasToken, "hasToken should be false after deletion")
    }

    // MARK: - Edge Cases

    func testMultipleWritesAndReads() {
        // Given
        let tokens = ["token1", "token2", "token3", "token4", "token5"]

        // When/Then
        for (index, token) in tokens.enumerated() {
            let writeSuccess = KeychainHelper.write(key: "auth_token", value: token)
            let readToken = KeychainHelper.getToken()

            XCTAssertTrue(writeSuccess, "write should succeed for token \(index)")
            XCTAssertEqual(readToken, token, "read should return correct token \(index)")
        }
    }

    func testLongTokenValue() {
        // Given: A very long JWT-like token
        let longToken = String(repeating: "a", count: 2000) + ".header.payload.signature"

        // When
        let writeSuccess = KeychainHelper.write(key: "auth_token", value: longToken)
        let readToken = KeychainHelper.getToken()

        // Then
        XCTAssertTrue(writeSuccess, "write should handle long tokens")
        XCTAssertEqual(readToken, longToken, "read should return the full long token")
    }

    func testConcurrentAccess() {
        // Given
        let expectation = XCTestExpectation(description: "Concurrent keychain access")
        expectation.expectedFulfillmentCount = 10
        let queue = DispatchQueue(label: "keychain.test", attributes: .concurrent)

        // When: Multiple concurrent writes and reads
        for i in 0..<10 {
            queue.async {
                let token = "concurrent-token-\(i)"
                _ = KeychainHelper.write(key: "auth_token", value: token)
                _ = KeychainHelper.getToken()
                expectation.fulfill()
            }
        }

        // Then: No crashes, operations complete
        wait(for: [expectation], timeout: 5.0)
    }
}

/**
 * APIClientTests - Unit tests for APIClient
 *
 * Tests network layer functionality for the share extension.
 * Uses URLProtocol mocking to avoid actual network requests.
 */

import XCTest
@testable import ShareExtension

// MARK: - Mock URL Protocol

class MockURLProtocol: URLProtocol {
    static var requestHandler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool {
        return true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        return request
    }

    override func startLoading() {
        guard let handler = MockURLProtocol.requestHandler else {
            fatalError("MockURLProtocol.requestHandler is unavailable")
        }

        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

// MARK: - Test Helper for Keychain Mocking

/// Mock keychain for testing
class MockKeychainHelper {
    static var mockToken: String?

    static func setup(token: String?) {
        mockToken = token
    }

    static func reset() {
        mockToken = nil
    }
}

// MARK: - Tests

final class APIClientTests: XCTestCase {

    var apiClient: APIClient!
    var mockSession: URLSession!
    let testBaseURL = "https://test.atlasi.app"

    override func setUp() async throws {
        try await super.setUp()

        // Configure URLSession to use mock protocol
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        mockSession = URLSession(configuration: config)

        // Create API client with test base URL and mock session
        apiClient = await APIClient(baseURL: testBaseURL, session: mockSession)

        // Reset mock handler
        MockURLProtocol.requestHandler = nil
    }

    override func tearDown() {
        apiClient = nil
        mockSession = nil
        MockURLProtocol.requestHandler = nil
        MockKeychainHelper.reset()
        super.tearDown()
    }

    // MARK: - APIError Tests

    func testAPIErrorDescriptions() {
        // Test all error cases have proper descriptions
        XCTAssertEqual(APIError.invalidURL.errorDescription, "Invalid URL")
        XCTAssertEqual(APIError.noToken.errorDescription, "Not signed in")
        XCTAssertEqual(APIError.unauthorized.errorDescription, "Session expired")
        XCTAssertEqual(APIError.timeout.errorDescription, "Request timed out")

        let networkError = APIError.networkError(NSError(domain: "test", code: -1))
        XCTAssertTrue(networkError.errorDescription?.contains("Network error") ?? false)

        let serverError = APIError.serverError(500, "Internal error")
        XCTAssertEqual(serverError.errorDescription, "Internal error")

        let serverErrorNoMessage = APIError.serverError(500, nil)
        XCTAssertEqual(serverErrorNoMessage.errorDescription, "Server error (500)")

        let decodingError = APIError.decodingError(NSError(domain: "test", code: -1))
        XCTAssertEqual(decodingError.errorDescription, "Invalid response")
    }

    func testAPIErrorIsRetryable() {
        // Network errors are retryable
        let networkError = APIError.networkError(NSError(domain: "test", code: -1))
        XCTAssertTrue(networkError.isRetryable)

        // Timeout is retryable
        XCTAssertTrue(APIError.timeout.isRetryable)

        // 5xx server errors are retryable
        XCTAssertTrue(APIError.serverError(500, nil).isRetryable)
        XCTAssertTrue(APIError.serverError(502, nil).isRetryable)
        XCTAssertTrue(APIError.serverError(503, nil).isRetryable)

        // 4xx errors are not retryable
        XCTAssertFalse(APIError.serverError(400, nil).isRetryable)
        XCTAssertFalse(APIError.serverError(404, nil).isRetryable)
        XCTAssertFalse(APIError.serverError(422, nil).isRetryable)

        // Auth errors are not retryable
        XCTAssertFalse(APIError.noToken.isRetryable)
        XCTAssertFalse(APIError.unauthorized.isRetryable)

        // Invalid URL is not retryable
        XCTAssertFalse(APIError.invalidURL.isRetryable)

        // Decoding error is not retryable
        let decodingError = APIError.decodingError(NSError(domain: "test", code: -1))
        XCTAssertFalse(decodingError.isRetryable)
    }

    // MARK: - Request Building Tests

    func testIngestSocialRequestFormat() async throws {
        // This test verifies the request structure without actual network calls
        // The actual implementation requires a valid token in Keychain

        // Given: A URL to ingest
        let testURL = "https://www.tiktok.com/@user/video/123"
        let testCaption = "Great place!"

        // Verify SocialIngestRequest encodes correctly
        let request = SocialIngestRequest(url: testURL, caption: testCaption)
        let encoder = JSONEncoder()
        let data = try encoder.encode(request)
        let decoded = try JSONDecoder().decode([String: String].self, from: data)

        XCTAssertEqual(decoded["url"], testURL)
        XCTAssertEqual(decoded["caption"], testCaption)
    }

    func testSaveToTripRequestFormat() async throws {
        // Given: A save to trip request
        let place = DetectedPlace(
            googlePlaceId: "ChIJ123",
            name: "Test Restaurant",
            address: "123 Main St",
            latitude: 40.7128,
            longitude: -74.0060,
            countryCode: "US",
            confidence: 0.9,
            types: ["restaurant"]
        )

        let request = SaveToTripRequest(
            tripId: "trip-123",
            provider: .tiktok,
            canonicalUrl: "https://www.tiktok.com/@user/video/123",
            thumbnailUrl: "https://example.com/thumb.jpg",
            authorHandle: "foodie",
            title: "Great restaurant",
            place: place,
            entryType: "food",
            notes: "Must visit!"
        )

        // When: Encoding the request
        let encoder = JSONEncoder()
        let data = try encoder.encode(request)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        // Then: Verify encoding
        XCTAssertEqual(json?["trip_id"] as? String, "trip-123")
        XCTAssertEqual(json?["provider"] as? String, "tiktok")
        XCTAssertEqual(json?["canonical_url"] as? String, "https://www.tiktok.com/@user/video/123")
        XCTAssertEqual(json?["thumbnail_url"] as? String, "https://example.com/thumb.jpg")
        XCTAssertEqual(json?["author_handle"] as? String, "foodie")
        XCTAssertEqual(json?["entry_type"] as? String, "food")
        XCTAssertEqual(json?["notes"] as? String, "Must visit!")

        // Verify place is properly encoded
        let placeDict = json?["place"] as? [String: Any]
        XCTAssertEqual(placeDict?["google_place_id"] as? String, "ChIJ123")
        XCTAssertEqual(placeDict?["name"] as? String, "Test Restaurant")
    }

    func testPlaceAutocompleteRequestFormat() async throws {
        // Given: A place autocomplete request
        let request = PlaceAutocompleteRequest(query: "coffee shop", countryCode: "US")

        // When: Encoding the request
        let encoder = JSONEncoder()
        let data = try encoder.encode(request)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        // Then: Verify encoding
        XCTAssertEqual(json?["query"] as? String, "coffee shop")
        XCTAssertEqual(json?["country_code"] as? String, "US")
    }

    func testPlaceAutocompleteRequestWithoutCountryCode() async throws {
        // Given: A request without country code
        let request = PlaceAutocompleteRequest(query: "restaurant", countryCode: nil)

        // When: Encoding the request
        let encoder = JSONEncoder()
        let data = try encoder.encode(request)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        // Then: Verify encoding
        XCTAssertEqual(json?["query"] as? String, "restaurant")
        XCTAssertNil(json?["country_code"])
    }

    func testCreateTripRequestFormat() async throws {
        // Given: A create trip request
        let request = CreateTripRequest(name: "Summer Trip", countryCode: "IT")

        // When: Encoding the request
        let encoder = JSONEncoder()
        let data = try encoder.encode(request)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        // Then: Verify encoding
        XCTAssertEqual(json?["name"] as? String, "Summer Trip")
        XCTAssertEqual(json?["country_code"] as? String, "IT")
    }

    // MARK: - Response Decoding Tests

    func testSocialIngestResponseDecoding() throws {
        // Given: A JSON response from /ingest/social
        let jsonString = """
        {
            "provider": "tiktok",
            "canonical_url": "https://www.tiktok.com/@user/video/123",
            "thumbnail_url": "https://example.com/thumb.jpg",
            "author_handle": "foodie123",
            "title": "Amazing food spot",
            "detected_place": {
                "google_place_id": "ChIJ123",
                "name": "Great Restaurant",
                "address": "123 Main St, NYC",
                "latitude": 40.7128,
                "longitude": -74.0060,
                "country": "United States",
                "country_code": "US",
                "confidence": 0.85,
                "primary_type": "restaurant",
                "types": ["restaurant", "food"]
            },
            "detected_country": {
                "country_code": "US",
                "country_name": "United States",
                "latitude": 39.8283,
                "longitude": -98.5795
            }
        }
        """

        // When: Decoding the response
        let data = jsonString.data(using: .utf8)!
        let response = try JSONDecoder().decode(SocialIngestResponse.self, from: data)

        // Then: Verify decoding
        XCTAssertEqual(response.provider, .tiktok)
        XCTAssertEqual(response.canonicalUrl, "https://www.tiktok.com/@user/video/123")
        XCTAssertEqual(response.thumbnailUrl, "https://example.com/thumb.jpg")
        XCTAssertEqual(response.authorHandle, "foodie123")
        XCTAssertEqual(response.title, "Amazing food spot")

        XCTAssertNotNil(response.detectedPlace)
        XCTAssertEqual(response.detectedPlace?.googlePlaceId, "ChIJ123")
        XCTAssertEqual(response.detectedPlace?.name, "Great Restaurant")
        XCTAssertEqual(response.detectedPlace?.countryCode, "US")
        XCTAssertEqual(response.detectedPlace?.confidence, 0.85)

        XCTAssertNotNil(response.detectedCountry)
        XCTAssertEqual(response.detectedCountry?.countryCode, "US")
    }

    func testSocialIngestResponseWithoutPlace() throws {
        // Given: A response without detected place
        let jsonString = """
        {
            "provider": "instagram",
            "canonical_url": "https://www.instagram.com/reel/ABC123",
            "thumbnail_url": null,
            "author_handle": "user123",
            "title": "Random video",
            "detected_place": null,
            "detected_country": null
        }
        """

        // When: Decoding the response
        let data = jsonString.data(using: .utf8)!
        let response = try JSONDecoder().decode(SocialIngestResponse.self, from: data)

        // Then: Verify decoding
        XCTAssertEqual(response.provider, .instagram)
        XCTAssertNil(response.detectedPlace)
        XCTAssertNil(response.detectedCountry)
    }

    func testSaveToTripResponseDecoding() throws {
        // Given: A JSON response from /ingest/save-to-trip
        let jsonString = """
        {
            "id": "entry-123",
            "trip_id": "trip-456",
            "type": "food",
            "title": "Amazing Restaurant",
            "notes": "Great food!",
            "created_at": "2024-01-15T10:30:00Z"
        }
        """

        // When: Decoding the response
        let data = jsonString.data(using: .utf8)!
        let response = try JSONDecoder().decode(SaveToTripResponse.self, from: data)

        // Then: Verify decoding
        XCTAssertEqual(response.id, "entry-123")
        XCTAssertEqual(response.tripId, "trip-456")
        XCTAssertEqual(response.type, "food")
        XCTAssertEqual(response.title, "Amazing Restaurant")
        XCTAssertEqual(response.notes, "Great food!")
    }

    func testTripResponseDecoding() throws {
        // Given: A JSON response from /trips
        let jsonString = """
        {
            "id": "trip-123",
            "name": "Italy Summer",
            "country_code": "IT",
            "created_at": "2024-06-01T00:00:00.000Z"
        }
        """

        // When: Decoding the response
        let data = jsonString.data(using: .utf8)!
        let trip = try JSONDecoder().decode(Trip.self, from: data)

        // Then: Verify decoding
        XCTAssertEqual(trip.id, "trip-123")
        XCTAssertEqual(trip.name, "Italy Summer")
        XCTAssertEqual(trip.countryCode, "IT")
        XCTAssertNotNil(trip.createdAt)
    }

    func testPlacePredictionDecoding() throws {
        // Given: A JSON response from /places/autocomplete
        let jsonString = """
        {
            "place_id": "ChIJ123",
            "main_text": "Coffee Shop",
            "secondary_text": "123 Main St, NYC",
            "types": ["cafe", "food"]
        }
        """

        // When: Decoding the response
        let data = jsonString.data(using: .utf8)!
        let prediction = try JSONDecoder().decode(PlacePrediction.self, from: data)

        // Then: Verify decoding
        XCTAssertEqual(prediction.placeId, "ChIJ123")
        XCTAssertEqual(prediction.mainText, "Coffee Shop")
        XCTAssertEqual(prediction.secondaryText, "123 Main St, NYC")
        XCTAssertEqual(prediction.types, ["cafe", "food"])
        XCTAssertEqual(prediction.id, "ChIJ123") // Identifiable
    }

    func testCountryDecoding() throws {
        // Given: A JSON response from /countries
        let jsonString = """
        {
            "code": "IT",
            "name": "Italy",
            "flag_url": "https://example.com/it.png"
        }
        """

        // When: Decoding the response
        let data = jsonString.data(using: .utf8)!
        let country = try JSONDecoder().decode(Country.self, from: data)

        // Then: Verify decoding
        XCTAssertEqual(country.code, "IT")
        XCTAssertEqual(country.name, "Italy")
    }

    // MARK: - DetectedPlace Tests

    func testDetectedPlaceFromPrediction() {
        // Given: A place prediction
        let prediction = PlacePrediction(
            placeId: "ChIJ123",
            mainText: "Test Place",
            secondaryText: "123 Main St",
            types: ["restaurant"]
        )

        // When: Creating DetectedPlace from prediction
        let detectedPlace = DetectedPlace.from(prediction: prediction)

        // Then: Verify conversion
        XCTAssertEqual(detectedPlace.googlePlaceId, "ChIJ123")
        XCTAssertEqual(detectedPlace.name, "Test Place")
        XCTAssertEqual(detectedPlace.address, "123 Main St")
        XCTAssertEqual(detectedPlace.confidence, 1.0)
        XCTAssertEqual(detectedPlace.types, ["restaurant"])
    }

    func testDetectedPlaceManualEntry() {
        // When: Creating a manual entry
        let detectedPlace = DetectedPlace.manualEntry(name: "My Place", address: "456 Oak Ave")

        // Then: Verify values
        XCTAssertNil(detectedPlace.googlePlaceId)
        XCTAssertEqual(detectedPlace.name, "My Place")
        XCTAssertEqual(detectedPlace.address, "456 Oak Ave")
        XCTAssertEqual(detectedPlace.confidence, 1.0)
    }
}

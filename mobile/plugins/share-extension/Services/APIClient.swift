/**
 * APIClient - Network layer for share extension API calls
 *
 * Provides async/await networking with automatic token injection.
 */

import Foundation

enum APIError: Error, LocalizedError {
    case invalidURL
    case noToken
    case unauthorized
    case networkError(Error)
    case serverError(Int, String?)
    case decodingError(Error)
    case timeout

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .noToken:
            return "Not signed in"
        case .unauthorized:
            return "Session expired"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .serverError(let code, let message):
            return message ?? "Server error (\(code))"
        case .decodingError:
            return "Invalid response"
        case .timeout:
            return "Request timed out"
        }
    }

    var isRetryable: Bool {
        switch self {
        case .networkError, .timeout:
            return true
        case .serverError(let code, _):
            return code >= 500
        default:
            return false
        }
    }
}

actor APIClient {
    // MARK: - Configuration

    /// Base URL for API requests
    /// In production, this should be loaded from Info.plist or a config file
    private let baseURL: String

    /// URLSession for network requests (injectable for testing)
    private let session: URLSession

    /// Timeout for ingest requests (longer due to oEmbed + Place extraction)
    private let ingestTimeout: TimeInterval = 15.0

    /// Timeout for other requests
    private let defaultTimeout: TimeInterval = 10.0

    // MARK: - Initialization

    init(session: URLSession = .shared) {
        // Priority:
        // 1. App Group storage (set by main app from EXPO_PUBLIC_API_URL)
        // 2. Info.plist API_BASE_URL (can be set by Expo config plugin)
        // 3. Production URL fallback
        if let url = AppGroupStorage.getString("API_BASE_URL"), !url.isEmpty {
            self.baseURL = url
        } else if let url = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String,
                  !url.isEmpty {
            self.baseURL = url
        } else {
            // Default to production URL
            self.baseURL = "https://atlasi.app"
        }
        self.session = session
    }

    init(baseURL: String, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    // MARK: - Public API

    /// Process a social URL via /ingest/social
    func ingestSocial(url: String, caption: String?) async throws -> SocialIngestResponse {
        let request = SocialIngestRequest(url: url, caption: caption)
        return try await post(
            path: "/ingest/social",
            body: request,
            timeout: ingestTimeout
        )
    }

    /// Save an entry to a trip via /ingest/save-to-trip
    func saveToTrip(request: SaveToTripRequest) async throws -> SaveToTripResponse {
        return try await post(
            path: "/ingest/save-to-trip",
            body: request,
            timeout: defaultTimeout
        )
    }

    /// Get user's trips
    func getTrips() async throws -> [Trip] {
        return try await get(path: "/trips", timeout: defaultTimeout)
    }

    /// Create a new trip
    func createTrip(name: String, countryCode: String) async throws -> Trip {
        let request = CreateTripRequest(name: name, countryCode: countryCode)
        return try await post(path: "/trips", body: request, timeout: defaultTimeout)
    }

    /// Search for places via /places/autocomplete
    func searchPlaces(query: String, countryCode: String?) async throws -> [PlacePrediction] {
        let request = PlaceAutocompleteRequest(query: query, countryCode: countryCode)
        return try await post(path: "/places/autocomplete", body: request, timeout: defaultTimeout)
    }

    /// Get list of countries
    func getCountries() async throws -> [Country] {
        return try await get(path: "/countries", timeout: defaultTimeout)
    }

    // MARK: - Private Helpers

    private func get<T: Decodable>(path: String, timeout: TimeInterval) async throws -> T {
        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }

        guard let token = KeychainHelper.getToken() else {
            throw APIError.noToken
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = timeout

        return try await execute(request)
    }

    private func post<T: Decodable, B: Encodable>(
        path: String,
        body: B,
        timeout: TimeInterval
    ) async throws -> T {
        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }

        guard let token = KeychainHelper.getToken() else {
            throw APIError.noToken
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = timeout

        let encoder = JSONEncoder()
        request.httpBody = try encoder.encode(body)

        return try await execute(request)
    }

    private func execute<T: Decodable>(_ request: URLRequest) async throws -> T {
        let data: Data
        let response: URLResponse

        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where error.code == .timedOut {
            throw APIError.timeout
        } catch {
            throw APIError.networkError(error)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError(0, "Invalid response")
        }

        switch httpResponse.statusCode {
        case 200...299:
            do {
                let decoder = JSONDecoder()
                return try decoder.decode(T.self, from: data)
            } catch {
                NSLog("[Atlasi APIClient] Decoding error: \(error)")
                throw APIError.decodingError(error)
            }

        case 401:
            throw APIError.unauthorized

        default:
            let message = String(data: data, encoding: .utf8)
            NSLog("[Atlasi APIClient] Server error \(httpResponse.statusCode): \(message ?? "no body")")
            throw APIError.serverError(httpResponse.statusCode, message)
        }
    }
}

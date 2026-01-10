/**
 * Trip - Trip model for share extension
 *
 * Represents a user's trip with basic metadata.
 */

import Foundation

struct Trip: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    let countryCode: String?
    let createdAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case countryCode = "country_code"
        case createdAt = "created_at"
    }

    init(id: String, name: String, countryCode: String?, createdAt: Date? = nil) {
        self.id = id
        self.name = name
        self.countryCode = countryCode
        self.createdAt = createdAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        countryCode = try container.decodeIfPresent(String.self, forKey: .countryCode)

        // Handle ISO8601 date string
        if let dateString = try container.decodeIfPresent(String.self, forKey: .createdAt) {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            createdAt = formatter.date(from: dateString)
        } else {
            createdAt = nil
        }
    }
}

// MARK: - Trip Creation Request

struct CreateTripRequest: Codable {
    let name: String
    let countryCode: String

    enum CodingKeys: String, CodingKey {
        case name
        case countryCode = "country_code"
    }
}

// MARK: - Trip Response

struct TripsResponse: Codable {
    let trips: [Trip]
}

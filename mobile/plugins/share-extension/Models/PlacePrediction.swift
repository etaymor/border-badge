/**
 * PlacePrediction - Autocomplete prediction model
 *
 * Represents a place prediction from the /places/autocomplete endpoint.
 */

import Foundation

struct PlacePrediction: Codable, Identifiable, Equatable {
    let placeId: String
    let mainText: String
    let secondaryText: String?
    let types: [String]

    /// Identifiable conformance
    var id: String { placeId }

    enum CodingKeys: String, CodingKey {
        case placeId = "place_id"
        case mainText = "main_text"
        case secondaryText = "secondary_text"
        case types
    }
}

// MARK: - Autocomplete Request

struct PlaceAutocompleteRequest: Codable {
    let query: String
    let countryCode: String?

    enum CodingKeys: String, CodingKey {
        case query
        case countryCode = "country_code"
    }
}

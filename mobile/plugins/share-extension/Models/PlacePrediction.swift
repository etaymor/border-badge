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

// MARK: - Selected Place (user selection or from ingest)

struct SelectedPlace: Codable, Equatable {
    let googlePlaceId: String?
    let name: String
    let address: String?
    let latitude: Double?
    let longitude: Double?
    let countryCode: String?
    let confidence: Double
    let primaryType: String?
    let types: [String]

    /// Create from a DetectedPlace
    init(from detected: DetectedPlace) {
        self.googlePlaceId = detected.googlePlaceId
        self.name = detected.name
        self.address = detected.address
        self.latitude = detected.latitude
        self.longitude = detected.longitude
        self.countryCode = detected.countryCode
        self.confidence = detected.confidence
        self.primaryType = detected.primaryType
        self.types = detected.types
    }

    /// Create from a PlacePrediction (partial data, needs details fetch)
    init(from prediction: PlacePrediction) {
        self.googlePlaceId = prediction.placeId
        self.name = prediction.mainText
        self.address = prediction.secondaryText
        self.latitude = nil
        self.longitude = nil
        self.countryCode = nil
        self.confidence = 1.0  // User explicitly selected
        self.primaryType = nil
        self.types = prediction.types
    }

    /// Create for manual entry
    init(name: String, address: String? = nil) {
        self.googlePlaceId = nil
        self.name = name
        self.address = address
        self.latitude = nil
        self.longitude = nil
        self.countryCode = nil
        self.confidence = 1.0
        self.primaryType = nil
        self.types = []
    }

    /// Convert to DetectedPlace for API request
    func toDetectedPlace() -> DetectedPlace {
        DetectedPlace(
            googlePlaceId: googlePlaceId,
            name: name,
            address: address,
            latitude: latitude,
            longitude: longitude,
            countryCode: countryCode,
            confidence: confidence,
            primaryType: primaryType,
            types: types
        )
    }
}

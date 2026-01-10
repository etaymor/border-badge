/**
 * IngestResponse - API response models for social ingest
 *
 * Matches the Python Pydantic schemas from social_ingest.py
 */

import Foundation

// MARK: - Social Provider

enum SocialProvider: String, Codable {
    case tiktok
    case instagram
}

// MARK: - Detected Place

struct DetectedPlace: Codable, Equatable {
    let googlePlaceId: String?
    let name: String
    let address: String?
    let latitude: Double?
    let longitude: Double?
    let city: String?
    let country: String?
    let countryCode: String?
    let confidence: Double
    let primaryType: String?
    let types: [String]
    let googlePhotoUrl: String?

    enum CodingKeys: String, CodingKey {
        case googlePlaceId = "google_place_id"
        case name
        case address
        case latitude
        case longitude
        case city
        case country
        case countryCode = "country_code"
        case confidence
        case primaryType = "primary_type"
        case types
        case googlePhotoUrl = "google_photo_url"
    }

    init(
        googlePlaceId: String? = nil,
        name: String,
        address: String? = nil,
        latitude: Double? = nil,
        longitude: Double? = nil,
        city: String? = nil,
        country: String? = nil,
        countryCode: String? = nil,
        confidence: Double = 0.0,
        primaryType: String? = nil,
        types: [String] = [],
        googlePhotoUrl: String? = nil
    ) {
        self.googlePlaceId = googlePlaceId
        self.name = name
        self.address = address
        self.latitude = latitude
        self.longitude = longitude
        self.city = city
        self.country = country
        self.countryCode = countryCode
        self.confidence = confidence
        self.primaryType = primaryType
        self.types = types
        self.googlePhotoUrl = googlePhotoUrl
    }

    // MARK: - Factory Methods

    /// Create from a PlacePrediction (partial data, needs details fetch)
    static func from(prediction: PlacePrediction) -> DetectedPlace {
        DetectedPlace(
            googlePlaceId: prediction.placeId,
            name: prediction.mainText,
            address: prediction.secondaryText,
            confidence: 1.0,  // User explicitly selected
            types: prediction.types
        )
    }

    /// Create for manual entry
    static func manualEntry(name: String, address: String? = nil) -> DetectedPlace {
        DetectedPlace(
            name: name,
            address: address,
            confidence: 1.0
        )
    }
}

// MARK: - Detected Country

struct DetectedCountry: Codable, Equatable {
    let countryCode: String
    let countryName: String
    let latitude: Double?
    let longitude: Double?

    enum CodingKeys: String, CodingKey {
        case countryCode = "country_code"
        case countryName = "country_name"
        case latitude
        case longitude
    }
}

// MARK: - Social Ingest Request

struct SocialIngestRequest: Codable {
    let url: String
    let caption: String?
}

// MARK: - Social Ingest Response

struct SocialIngestResponse: Codable {
    let provider: SocialProvider
    let canonicalUrl: String
    let thumbnailUrl: String?
    let authorHandle: String?
    let title: String?
    let detectedPlace: DetectedPlace?
    let detectedCountry: DetectedCountry?

    enum CodingKeys: String, CodingKey {
        case provider
        case canonicalUrl = "canonical_url"
        case thumbnailUrl = "thumbnail_url"
        case authorHandle = "author_handle"
        case title
        case detectedPlace = "detected_place"
        case detectedCountry = "detected_country"
    }
}

// MARK: - Save to Trip Request

struct SaveToTripRequest: Codable {
    let tripId: String
    let provider: SocialProvider
    let canonicalUrl: String
    let thumbnailUrl: String?
    let authorHandle: String?
    let title: String?
    let place: DetectedPlace?
    let entryType: String
    let notes: String?

    enum CodingKeys: String, CodingKey {
        case tripId = "trip_id"
        case provider
        case canonicalUrl = "canonical_url"
        case thumbnailUrl = "thumbnail_url"
        case authorHandle = "author_handle"
        case title
        case place
        case entryType = "entry_type"
        case notes
    }
}

// MARK: - Save to Trip Response

struct SaveToTripResponse: Codable {
    let id: String
    let tripId: String
    let type: String
    let title: String?
    let notes: String?
    let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case tripId = "trip_id"
        case type
        case title
        case notes
        case createdAt = "created_at"
    }
}

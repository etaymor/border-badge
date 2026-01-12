//
// QueuedShareApp.swift
// Minimal queue model for the main app (Atlasi) to decode the extension queue.
//
// IMPORTANT: This file is copied to the main Atlasi app target by withShareExtension.js.
// It contains self-contained copies of all models needed to decode QueuedShare items
// from App Group storage. The main app doesn't link against Share Extension Swift files,
// so it needs these lightweight copies.
//
// See also: QueuedShare.swift (used by Share Extension, has constructors for creating items)
//
// SYNC WARNING: These struct definitions must match the extension's models exactly.
// Run `node plugins/share-extension/scripts/validate-model-sync.js` to check for drift.
// The build will fail if definitions diverge.
//

import Foundation

// MARK: - Detected Country
// Source: IngestResponse.swift

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

// MARK: - Detected Place
// Source: IngestResponse.swift

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
}

// MARK: - Social Provider
// Source: IngestResponse.swift

enum SocialProvider: String, Codable {
    case tiktok
    case instagram
}

// MARK: - Social Ingest Response
// Source: IngestResponse.swift

struct SocialIngestResponse: Codable, Equatable {
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

// MARK: - Entry Type
// Source: EntryType.swift

enum EntryType: String, Codable {
    case place
    case food
    case stay
    case experience
}

// MARK: - Queued Share
// Source: QueuedShare.swift

struct QueuedShare: Codable, Identifiable, Equatable {
    let id: String
    let url: String
    let caption: String?
    let timestamp: Date
    let reason: QueueReason
    let ingestResult: SocialIngestResponse?
    let selectedTripId: String?
    let selectedPlace: DetectedPlace?
    let entryType: EntryType?
    let notes: String?

    enum QueueReason: String, Codable {
        case unauthenticated
        case networkError
        case serverError
        case timeout
    }

    var isValid: Bool {
        let maxAge: TimeInterval = 7 * 24 * 60 * 60
        return Date().timeIntervalSince(timestamp) < maxAge
    }
}

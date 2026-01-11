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

import Foundation

// Lightweight copies of extension models to keep Atlasi target independent.
// These must stay in sync with the extension's model definitions.
struct DetectedCountry: Codable, Equatable {
    let countryCode: String?
    let countryName: String?
    let latitude: Double?
    let longitude: Double?
}

struct DetectedPlace: Codable, Equatable {
    let googlePlaceId: String?
    let name: String?
    let address: String?
    let latitude: Double?
    let longitude: Double?
    let city: String?
    let country: String?
    let countryCode: String?
    let confidence: Double?
    let primaryType: String?
    let types: [String]?
    let googlePhotoUrl: String?
}

struct SocialIngestResponse: Codable, Equatable {
    let provider: String?
    let canonicalUrl: String?
    let thumbnailUrl: String?
    let authorHandle: String?
    let title: String?
    let detectedPlace: DetectedPlace?
    let detectedCountry: DetectedCountry?
}

enum EntryType: String, Codable {
    case place
    case food
    case stay
    case experience
}

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

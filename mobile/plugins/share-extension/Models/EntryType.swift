/**
 * EntryType - Entry category types for saved places
 *
 * Matches the React Native EntryType from entryTypes.ts
 */

import SwiftUI

enum EntryType: String, CaseIterable, Codable {
    case place
    case food
    case stay
    case experience

    /// Display label for the entry type
    var label: String {
        switch self {
        case .place: return "Place"
        case .food: return "Food"
        case .stay: return "Stay"
        case .experience: return "Experience"
        }
    }

    /// SF Symbol icon name
    var icon: String {
        switch self {
        case .place: return "mappin.circle.fill"
        case .food: return "fork.knife"
        case .stay: return "bed.double.fill"
        case .experience: return "star.fill"
        }
    }

    /// Brand color for the entry type
    var color: Color {
        switch self {
        case .place: return BrandColors.adobeBrick
        case .food: return BrandColors.sunsetGold
        case .stay: return BrandColors.mossGreen
        case .experience: return BrandColors.midnightNavy
        }
    }

    /// Emoji representation
    var emoji: String {
        switch self {
        case .place: return "📍"
        case .food: return "🍽️"
        case .stay: return "🏨"
        case .experience: return "✨"
        }
    }
}

// MARK: - Type Inference from Google Places

extension EntryType {
    /// Infer entry type from Google Places type information
    /// - Parameters:
    ///   - primaryType: The primary type from Google Places (e.g., "restaurant")
    ///   - types: All types from Google Places
    /// - Returns: The inferred entry type
    static func from(primaryType: String?, types: [String]) -> EntryType {
        // Check primary type first
        if let primary = primaryType {
            if let type = typeFromGoogleType(primary) {
                return type
            }
        }

        // Fall back to checking all types
        for type in types {
            if let entryType = typeFromGoogleType(type) {
                return entryType
            }
        }

        // Default to place
        return .place
    }

    /// Map a single Google Places type to an entry type
    private static func typeFromGoogleType(_ googleType: String) -> EntryType? {
        // Food types
        let foodTypes = [
            "restaurant", "cafe", "bakery", "bar", "coffee_shop",
            "pizza_restaurant", "sushi_restaurant", "ice_cream_shop",
            "meal_delivery", "meal_takeaway", "food"
        ]

        // Stay types
        let stayTypes = [
            "hotel", "lodging", "motel", "hostel", "bed_and_breakfast",
            "campground", "rv_park", "resort"
        ]

        // Experience types
        let experienceTypes = [
            "tourist_attraction", "museum", "zoo", "aquarium",
            "amusement_park", "art_gallery", "concert_hall", "night_club",
            "spa", "stadium", "hiking_area", "ski_resort", "casino",
            "bowling_alley", "movie_theater", "theater"
        ]

        if foodTypes.contains(googleType) {
            return .food
        } else if stayTypes.contains(googleType) {
            return .stay
        } else if experienceTypes.contains(googleType) {
            return .experience
        }

        return nil
    }
}

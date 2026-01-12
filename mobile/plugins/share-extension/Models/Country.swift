/**
 * Country - Country model for trip creation
 */

import Foundation

struct Country: Codable, Identifiable, Equatable {
    let code: String
    let name: String
    let flagEmoji: String?

    var id: String { code }

    enum CodingKeys: String, CodingKey {
        case code
        case name
        case flagEmoji = "flag_emoji"
    }

    /// Display name with flag
    var displayName: String {
        if let flag = flagEmoji {
            return "\(flag) \(name)"
        }
        return name
    }

    /// Flag emoji (convenience accessor)
    var flag: String {
        return flagEmoji ?? ""
    }
}

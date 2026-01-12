/**
 * AnalyticsQueue - Queue analytics events for sync to main app
 *
 * This service queues analytics events from the iOS Share Extension.
 * Events are stored in App Group UserDefaults and synced to PostHog
 * when the main app comes to foreground.
 *
 * The same concurrency limitations as OfflineQueueService apply:
 * - Read-modify-write is not atomic
 * - Cross-process races are possible but rare
 * - Worst case: some analytics events are lost (acceptable for analytics)
 *
 * @see OfflineQueueService.swift for detailed concurrency documentation
 */

import Foundation

/// Analytics event to be synced to PostHog via the main app
struct AnalyticsEvent: Codable, Identifiable {
    let id: String
    let event: String
    let properties: [String: AnyCodable]?
    let timestamp: Date

    init(event: String, properties: [String: Any]? = nil) {
        self.id = UUID().uuidString
        self.event = event
        self.timestamp = Date()

        // Convert [String: Any] to [String: AnyCodable] for Codable support
        if let props = properties {
            self.properties = props.compactMapValues { AnyCodable($0) }
        } else {
            self.properties = nil
        }
    }

    /// Check if the event is still valid (not expired)
    var isValid: Bool {
        // Don't process events older than 7 days
        let maxAge: TimeInterval = 7 * 24 * 60 * 60
        return Date().timeIntervalSince(timestamp) < maxAge
    }
}

/// Type-erased Codable wrapper for analytics properties
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if container.decodeNil() {
            value = NSNull()
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unsupported type for AnyCodable"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        switch value {
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case is NSNull:
            try container.encodeNil()
        default:
            // Convert other types to string representation
            try container.encode(String(describing: value))
        }
    }
}

enum AnalyticsQueue {
    /// App Group identifier
    private static let appGroupID = "group.com.atlasi.app"

    /// Storage key for analytics queue
    private static let queueKey = "AnalyticsQueue"

    /// Max queue size to prevent unbounded growth
    private static let maxQueueSize = 50

    /// Serial queue for synchronizing access within this process
    private static let accessQueue = DispatchQueue(label: "com.atlasi.analyticsqueue.access")

    // MARK: - Public API

    /// Track an analytics event
    /// - Parameters:
    ///   - event: Event name (e.g., "share_extension_opened")
    ///   - properties: Optional dictionary of event properties
    static func track(_ event: String, properties: [String: Any]? = nil) {
        let analyticsEvent = AnalyticsEvent(event: event, properties: properties)

        accessQueue.sync {
            var queue = getQueue()
            queue.append(analyticsEvent)

            // Keep only newest items if queue exceeds max size
            if queue.count > maxQueueSize {
                let evictedCount = queue.count - maxQueueSize
                NSLog("[Atlasi AnalyticsQueue] Queue size exceeded, evicting \(evictedCount) oldest events")
                queue = Array(queue.suffix(maxQueueSize))
            }

            saveQueue(queue)
        }

        NSLog("[Atlasi AnalyticsQueue] Tracked: \(event)")
    }

    /// Get the current queue (for debugging)
    static func getQueueCount() -> Int {
        accessQueue.sync {
            getQueue().count
        }
    }

    // MARK: - Private Helpers

    private static var userDefaults: UserDefaults? {
        UserDefaults(suiteName: appGroupID)
    }

    private static func getQueue() -> [AnalyticsEvent] {
        guard let data = userDefaults?.data(forKey: queueKey),
              let queue = try? JSONDecoder().decode([AnalyticsEvent].self, from: data) else {
            return []
        }
        return queue
    }

    private static func saveQueue(_ queue: [AnalyticsEvent]) {
        guard let data = try? JSONEncoder().encode(queue) else {
            NSLog("[Atlasi AnalyticsQueue] Failed to encode queue")
            return
        }
        userDefaults?.set(data, forKey: queueKey)
    }
}

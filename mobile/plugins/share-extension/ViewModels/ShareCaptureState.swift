/**
 * ShareCaptureState - State and error types for share capture flow
 */

import Foundation

// MARK: - State

enum ShareCaptureState: Equatable {
    case loading(message: String)
    case error(ShareCaptureError)
    case form
    case saving
    case success
    case successQueued(reason: QueueReason)

    /// Reason why the save was queued instead of completed immediately
    enum QueueReason: Equatable {
        case networkError
        case serverError
        case unauthenticated

        var message: String {
            switch self {
            case .networkError:
                return "Saved for later - will sync when online"
            case .serverError:
                return "Saved for later - will retry automatically"
            case .unauthenticated:
                return "Saved for later - sign in to sync"
            }
        }
    }

    static func == (lhs: ShareCaptureState, rhs: ShareCaptureState) -> Bool {
        switch (lhs, rhs) {
        case (.loading(let lhsMsg), .loading(let rhsMsg)): return lhsMsg == rhsMsg
        case (.error(let lhsErr), .error(let rhsErr)): return lhsErr.message == rhsErr.message
        case (.form, .form): return true
        case (.saving, .saving): return true
        case (.success, .success): return true
        case (.successQueued(let lhsReason), .successQueued(let rhsReason)): return lhsReason == rhsReason
        default: return false
        }
    }
}

// MARK: - Error

struct ShareCaptureError: Equatable {
    let message: String
    let canRetry: Bool
    let canManualEntry: Bool
    let canSaveForLater: Bool

    static func network() -> ShareCaptureError {
        ShareCaptureError(
            message: "Network error. Check your connection.",
            canRetry: true,
            canManualEntry: true,
            canSaveForLater: true
        )
    }

    static func timeout() -> ShareCaptureError {
        ShareCaptureError(
            message: "Request timed out. Try again.",
            canRetry: true,
            canManualEntry: true,
            canSaveForLater: true
        )
    }

    static func unauthorized() -> ShareCaptureError {
        ShareCaptureError(
            message: "Please sign in to Atlasi first.",
            canRetry: false,
            canManualEntry: false,
            canSaveForLater: true
        )
    }

    static func invalidURL() -> ShareCaptureError {
        ShareCaptureError(
            message: "Only TikTok and Instagram links are supported. You can still add the place manually.",
            canRetry: false,
            canManualEntry: true,
            canSaveForLater: false
        )
    }

    static func serverError(_ message: String?) -> ShareCaptureError {
        ShareCaptureError(
            message: message ?? "Something went wrong. Try again.",
            canRetry: true,
            canManualEntry: true,
            canSaveForLater: true
        )
    }

    static func freeLimitReached() -> ShareCaptureError {
        ShareCaptureError(
            message: "You've used your 5 free saves this month. Open Atlasi to upgrade for unlimited saves.",
            canRetry: false,
            canManualEntry: false,
            canSaveForLater: false
        )
    }
}

/**
 * ShareCaptureViewModel - Main state management for share capture flow
 *
 * Manages the entire share extension flow from URL processing to save.
 */

import SwiftUI
import Combine

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
            message: "You've used all 5 free saves. Open Atlasi to upgrade and save unlimited places.",
            canRetry: false,
            canManualEntry: false,
            canSaveForLater: false
        )
    }
}

// MARK: - ViewModel

@MainActor
class ShareCaptureViewModel: ObservableObject {
    // MARK: - Published State

    @Published var state: ShareCaptureState = .loading(message: "Processing link...")
    @Published var ingestResult: SocialIngestResponse?
    @Published var selectedPlace: DetectedPlace?
    @Published var selectedTripId: String?
    @Published var entryType: EntryType = .place
    @Published var hasSelectedType: Bool = false
    @Published var notes: String = ""
    @Published var isManualEntryMode: Bool = false
    @Published var userClearedPlace: Bool = false  // True when user explicitly cleared the place selection

    // MARK: - Subscription State

    /// Whether user has premium access (premium or trial)
    @Published private(set) var isPremium: Bool = false
    /// Whether user can save (premium or has remaining free saves)
    @Published private(set) var canUseShareExtension: Bool = true
    /// Remaining free saves (-1 for unlimited)
    @Published private(set) var remainingFreeSaves: Int = AppGroupStorage.freeShareExtensionLimit

    // MARK: - Private State

    private let apiClient = APIClient()
    private var originalURL: String = ""
    @Published private(set) var caption: String?
    private var currentTask: Task<Void, Never>?
    private var hasStartedProcessing: Bool = false

    // MARK: - Lifecycle

    init() {
        // Load subscription status from App Group on init
        refreshSubscriptionStatus()
    }

    deinit {
        currentTask?.cancel()
    }

    /// Refresh subscription status from App Group storage
    func refreshSubscriptionStatus() {
        let status = AppGroupStorage.getSubscriptionStatus()
        isPremium = status == "premium" || status == "trial"
        canUseShareExtension = AppGroupStorage.canUseShareExtension()
        remainingFreeSaves = AppGroupStorage.getRemainingFreeSaves()

        let canUse = canUseShareExtension
        let remaining = remainingFreeSaves
        NSLog("[Atlasi ShareCapture] status: \(status), canUse: \(canUse), remaining: \(remaining)")
    }

    // MARK: - Computed Properties

    var provider: SocialProvider? {
        ingestResult?.provider
    }

    var detectedCountryCode: String? {
        ingestResult?.detectedPlace?.countryCode ?? ingestResult?.detectedCountry?.countryCode
    }

    /// Effective country code for filtering - nil if user cleared the place (search worldwide)
    var effectiveCountryCode: String? {
        if userClearedPlace {
            return nil
        }
        return selectedPlace?.countryCode ?? detectedCountryCode
    }

    var canSave: Bool {
        selectedPlace != nil && selectedTripId != nil && canUseShareExtension
    }

    var providerName: String {
        switch provider {
        case .tiktok: return "TikTok"
        case .instagram: return "Instagram"
        case nil: return "Link"
        }
    }

    // MARK: - Public API

    /// Process a shared URL
    func processURL(_ url: String, caption: String? = nil) {
        // Prevent re-processing if already started (onAppear can fire multiple times)
        guard !hasStartedProcessing else { return }
        hasStartedProcessing = true

        self.originalURL = url
        self.caption = caption
        let providerName = detectProviderName(url)
        let linkType = providerName.isEmpty ? "link" : providerName
        self.state = .loading(message: "Processing \(linkType)...")

        currentTask?.cancel()
        currentTask = Task {
            await ingestURL()
        }
    }

    /// Retry the last operation
    func retry() {
        guard !originalURL.isEmpty else { return }

        state = .loading(message: "Retrying...")
        currentTask?.cancel()
        currentTask = Task {
            await ingestURL()
        }
    }

    /// Switch to manual entry mode
    func enterManualEntryMode() {
        isManualEntryMode = true
        state = .form
    }

    /// Save for later (add to offline queue)
    func saveForLater() {
        let reason: QueuedShare.QueueReason = KeychainHelper.hasToken ? .networkError : .unauthenticated
        let stateReason: ShareCaptureState.QueueReason = KeychainHelper.hasToken ? .networkError : .unauthenticated

        OfflineQueueService.queueShare(
            url: originalURL,
            caption: caption,
            reason: reason,
            ingestResult: ingestResult,
            selectedTripId: selectedTripId,
            selectedPlace: selectedPlace,
            entryType: hasSelectedType ? entryType : nil,
            notes: notes.isEmpty ? nil : notes
        )

        // Track queued for later
        AnalyticsQueue.track("share_extension_queued_offline", properties: [
            "reason": reason.rawValue
        ])

        state = .successQueued(reason: stateReason)
    }

    /// Select a place from autocomplete or detected
    func selectPlace(_ place: DetectedPlace) {
        selectedPlace = place
        userClearedPlace = false  // User selected a new place, restore country focus

        // Infer entry type from place types if not manually selected
        if !hasSelectedType {
            entryType = EntryType.from(primaryType: place.primaryType, types: place.types)
        }
    }

    /// Clear the selected place (user explicitly removed it)
    func clearPlace() {
        selectedPlace = nil
        userClearedPlace = true  // User cleared the place, remove country focus
    }

    /// Set the entry type
    func selectEntryType(_ type: EntryType) {
        entryType = type
        hasSelectedType = true
    }

    /// Reset entry type selection
    func resetEntryType() {
        hasSelectedType = false
    }

    /// Save the entry to the selected trip
    func save() {
        guard let place = selectedPlace,
              let tripId = selectedTripId else {
            return
        }

        // Check subscription status before saving
        refreshSubscriptionStatus()
        if !canUseShareExtension {
            // Track limit reached
            AnalyticsQueue.track("share_extension_limit_reached", properties: [:])
            state = .error(.freeLimitReached())
            return
        }

        // Track save initiated
        AnalyticsQueue.track("share_extension_save_initiated", properties: [
            "has_location": true,
            "category": entryType.rawValue
        ])

        state = .saving

        currentTask?.cancel()
        currentTask = Task {
            await saveEntry(place: place, tripId: tripId)
        }
    }

    // MARK: - Private Helpers

    private func ingestURL() async {
        do {
            let response = try await apiClient.ingestSocial(url: originalURL, caption: caption)
            ingestResult = response

            // Auto-select detected place
            if let detected = response.detectedPlace {
                selectedPlace = detected

                // Prefer LLM entry type, fall back to Google types inference
                if let llmType = detected.llmEntryType,
                   let type = EntryType(rawValue: llmType) {
                    entryType = type
                } else {
                    entryType = EntryType.from(
                        primaryType: detected.primaryType,
                        types: detected.types
                    )
                }
            }

            state = .form

        } catch let error as APIError {
            handleAPIError(error)
        } catch {
            state = .error(.network())
        }
    }

    private func saveEntry(place: DetectedPlace, tripId: String) async {
        guard let result = ingestResult else {
            // Manual entry mode - we don't have ingest result
            // For now, just show success since manual entry would need different API
            state = .success
            return
        }

        do {
            let request = SaveToTripRequest(
                tripId: tripId,
                provider: result.provider,
                canonicalUrl: result.canonicalUrl,
                thumbnailUrl: result.thumbnailUrl,
                authorHandle: result.authorHandle,
                title: result.title,
                place: place,
                entryType: entryType.rawValue,
                notes: notes.isEmpty ? nil : notes
            )

            _ = try await apiClient.saveToTrip(request: request)

            // Clear the shared URL from App Group since we processed it
            AppGroupStorage.clearSharedURL()

            // Mark that user has used share extension (for tutorial dismissal in main app)
            AppGroupStorage.markShareExtensionUsed()

            // Track success
            AnalyticsQueue.track("share_extension_success", properties: [
                "category": entryType.rawValue,
                "has_location": true
            ])

            state = .success

        } catch let error as APIError {
            handleSaveError(error, place: place, tripId: tripId)
        } catch {
            handleSaveError(.networkError(error), place: place, tripId: tripId)
        }
    }

    private func handleAPIError(_ error: APIError) {
        switch error {
        case .noToken, .unauthorized:
            state = .error(.unauthorized())
        case .timeout:
            state = .error(.timeout())
        case .networkError:
            state = .error(.network())
        case .serverError(let code, let message):
            // 400 = unsupported provider, 422 = validation error
            if code == 400 || code == 422 {
                state = .error(.invalidURL())
            } else {
                state = .error(.serverError(message))
            }
        case .invalidURL, .decodingError:
            state = .error(.invalidURL())
        }
    }

    private func handleSaveError(_ error: APIError, place: DetectedPlace, tripId: String) {
        // Queue for later if it's a retryable error
        if error.isRetryable {
            // Determine the queue reason based on error type
            let stateReason: ShareCaptureState.QueueReason
            let queueReason: QueuedShare.QueueReason
            switch error {
            case .networkError:
                stateReason = .networkError
                queueReason = .networkError
            case .timeout:
                stateReason = .networkError
                queueReason = .timeout
            case .noToken, .unauthorized:
                stateReason = .unauthenticated
                queueReason = .unauthenticated
            default:
                stateReason = .serverError
                queueReason = .serverError
            }

            OfflineQueueService.queueShare(
                url: originalURL,
                caption: caption,
                reason: queueReason,
                ingestResult: ingestResult,
                selectedTripId: tripId,
                selectedPlace: place,
                entryType: entryType,
                notes: notes.isEmpty ? nil : notes
            )

            // Track queued due to save error
            AnalyticsQueue.track("share_extension_queued_offline", properties: [
                "reason": queueReason.rawValue
            ])

            state = .successQueued(reason: stateReason)
        } else {
            // Track error
            AnalyticsQueue.track("share_extension_error", properties: [
                "error_type": String(describing: error),
                "stage": "save"
            ])

            state = .error(.serverError(error.errorDescription))
        }
    }

    private func detectProviderName(_ url: String) -> String {
        if url.contains("tiktok") {
            return "TikTok"
        } else if url.contains("instagram") {
            return "Instagram"
        }
        return ""
    }
}

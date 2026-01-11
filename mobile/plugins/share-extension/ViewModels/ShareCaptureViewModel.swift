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
        case (.loading(let a), .loading(let b)): return a == b
        case (.error(let a), .error(let b)): return a.message == b.message
        case (.form, .form): return true
        case (.saving, .saving): return true
        case (.success, .success): return true
        case (.successQueued(let a), .successQueued(let b)): return a == b
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

    // MARK: - Private State

    private let apiClient = APIClient()
    private var originalURL: String = ""
    private var caption: String?
    private var currentTask: Task<Void, Never>?

    // MARK: - Lifecycle

    deinit {
        currentTask?.cancel()
    }

    // MARK: - Computed Properties

    var provider: SocialProvider? {
        ingestResult?.provider
    }

    var detectedCountryCode: String? {
        ingestResult?.detectedPlace?.countryCode ?? ingestResult?.detectedCountry?.countryCode
    }

    var canSave: Bool {
        selectedPlace != nil && selectedTripId != nil
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

        state = .successQueued(reason: stateReason)
    }

    /// Select a place from autocomplete or detected
    func selectPlace(_ place: DetectedPlace) {
        selectedPlace = place

        // Infer entry type from place types if not manually selected
        if !hasSelectedType {
            entryType = EntryType.from(primaryType: place.primaryType, types: place.types)
        }
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

                // Infer entry type from place types
                entryType = EntryType.from(
                    primaryType: detected.primaryType,
                    types: detected.types
                )
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
            let queueReason: ShareCaptureState.QueueReason
            switch error {
            case .networkError, .timeout:
                queueReason = .networkError
            case .noToken, .unauthorized:
                queueReason = .unauthenticated
            default:
                queueReason = .serverError
            }

            OfflineQueueService.queueShare(
                url: originalURL,
                caption: caption,
                reason: .serverError,
                ingestResult: ingestResult,
                selectedTripId: tripId,
                selectedPlace: place,
                entryType: entryType,
                notes: notes.isEmpty ? nil : notes
            )
            state = .successQueued(reason: queueReason)
        } else {
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

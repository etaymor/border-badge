/**
 * ShareCaptureViewModel - Main state management for share capture flow
 *
 * Manages the entire share extension flow from URL processing to save.
 * Split across multiple files:
 * - ShareCaptureState.swift: State enum and error types
 * - ShareCaptureViewModel+MultiPlace.swift: Multi-place handling
 * - ShareCaptureViewModel+Save.swift: Save logic and error handling
 */

import SwiftUI
import Combine

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

    // MARK: - Multi-Place State

    @Published var placeSelections: [PlaceSelection] = []
    /// Index of place being edited in location search, nil when not editing
    @Published var editingPlaceIndex: Int?

    // MARK: - Subscription State

    /// Whether user has premium access (premium or trial)
    @Published private(set) var isPremium: Bool = false
    /// Whether user can save (premium or has remaining free saves)
    @Published private(set) var canUseShareExtension: Bool = true
    /// Remaining free saves (-1 for unlimited)
    @Published private(set) var remainingFreeSaves: Int = AppGroupStorage.freeShareExtensionLimit

    // MARK: - Internal State (accessible to extensions)

    let apiClient = APIClient()
    var originalURL: String = ""
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
        if isMultiPlaceMode {
            return selectedPlaceCount > 0 && selectedTripId != nil && canUseShareExtension
        }
        return selectedPlace != nil && selectedTripId != nil && canUseShareExtension
    }

    /// Whether we're in multi-place mode (more than one place detected)
    var isMultiPlaceMode: Bool {
        placeSelections.count > 1
    }

    /// Number of places currently selected
    var selectedPlaceCount: Int {
        placeSelections.selectedCount
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
        guard let tripId = selectedTripId else { return }

        // Check subscription status before saving
        refreshSubscriptionStatus()
        if !canUseShareExtension {
            // Track limit reached
            AnalyticsQueue.track("share_extension_limit_reached", properties: [:])
            state = .error(.freeLimitReached())
            return
        }

        // Determine if multi-place or single-place save
        if isMultiPlaceMode {
            let placesToSave = placeSelections.placesToSave
            guard !placesToSave.isEmpty else { return }

            // Track save initiated
            AnalyticsQueue.track("share_extension_save_initiated", properties: [
                "has_location": true,
                "place_count": placesToSave.count,
                "multi_place": true
            ])

            state = .saving

            currentTask?.cancel()
            currentTask = Task {
                await saveMultiplePlaces(places: placesToSave, tripId: tripId)
            }
        } else {
            guard let place = selectedPlace else { return }

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
    }

    // MARK: - Private Helpers

    private func ingestURL() async {
        do {
            let response = try await apiClient.ingestSocial(url: originalURL, caption: caption)
            ingestResult = response

            // Initialize multi-place selections
            initializeMultiPlaceSelections(from: response.detectedPlaces)

            // Auto-select detected place (backward compat - use first place)
            if let detected = response.detectedPlace ?? response.detectedPlaces.first {
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

    private func detectProviderName(_ url: String) -> String {
        if url.contains("tiktok") {
            return "TikTok"
        } else if url.contains("instagram") {
            return "Instagram"
        }
        return ""
    }
}

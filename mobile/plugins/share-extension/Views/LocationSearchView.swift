/**
 * LocationSearchView - Google Places autocomplete search
 */

import SwiftUI
import Combine

struct LocationSearchView: View {
    @Binding var selectedPlace: DetectedPlace?
    let countryCode: String?
    let onPlaceSelected: (DetectedPlace) -> Void
    let onPlaceCleared: (() -> Void)?

    /// Optional injected viewModel for testing. If nil, creates default.
    @ObservedObject private var viewModel: LocationSearchViewModel
    @State private var isEditing: Bool = false

    init(
        selectedPlace: Binding<DetectedPlace?>,
        countryCode: String?,
        onPlaceSelected: @escaping (DetectedPlace) -> Void,
        onPlaceCleared: (() -> Void)? = nil,
        viewModel: LocationSearchViewModel? = nil
    ) {
        self._selectedPlace = selectedPlace
        self.countryCode = countryCode
        self.onPlaceSelected = onPlaceSelected
        self.onPlaceCleared = onPlaceCleared
        self._viewModel = ObservedObject(wrappedValue: viewModel ?? LocationSearchViewModel())
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "Confirm Location")

            if let place = selectedPlace, !isEditing {
                // Selected place display
                SelectedPlaceDisplay(
                    place: place,
                    onChangePlace: {
                        isEditing = true
                        viewModel.searchText = ""
                        // Notify parent that place was cleared (for country code reset)
                        onPlaceCleared?()
                    }
                )
            } else {
                // Search field and results
                VStack(spacing: 8) {
                    SearchField(
                        text: $viewModel.searchText,
                        placeholder: "Search for a place...",
                        isLoading: viewModel.isSearching,
                        errorMessage: viewModel.errorMessage
                    )
                    .onChange(of: viewModel.searchText) { newValue in
                        viewModel.search(query: newValue, countryCode: countryCode)
                    }

                    if !viewModel.predictions.isEmpty {
                        SearchResultsList(
                            predictions: viewModel.predictions,
                            onSelect: { prediction in
                                let place = DetectedPlace.from(prediction: prediction)
                                selectedPlace = place
                                onPlaceSelected(place)
                                isEditing = false
                                viewModel.clearSearch()
                            }
                        )
                    }
                }
            }
        }
    }
}

// MARK: - Search Field

private struct SearchField: View {
    @Binding var text: String
    let placeholder: String
    let isLoading: Bool
    var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 12) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 18))
                    .foregroundColor(BrandColors.stormGray)

                ZStack(alignment: .leading) {
                    if text.isEmpty {
                        Text(placeholder)
                            .font(Typography.body(16))
                            .foregroundColor(BrandColors.stormGray)
                    }
                    TextField("", text: $text)
                        .font(Typography.body(16))
                        .foregroundColor(BrandColors.midnightNavy)
                }

                if isLoading {
                    ProgressView()
                        .tint(BrandColors.sunsetGold)
                        .scaleEffect(0.8)
                } else if !text.isEmpty {
                    Button(action: { text = "" }, label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 20))
                            .foregroundColor(BrandColors.stormGray.opacity(0.6))
                    })
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(Color.white.opacity(0.4))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.white.opacity(0.6), lineWidth: 1)
            )

            // Error message below the field
            if let error = errorMessage {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.circle")
                        .font(.system(size: 12))
                    Text(error)
                        .font(Typography.body(12))
                }
                .foregroundColor(BrandColors.adobeBrick)
                .padding(.leading, 4)
            }
        }
    }
}

// MARK: - Search Results List

private struct SearchResultsList: View {
    let predictions: [PlacePrediction]
    let onSelect: (PlacePrediction) -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                ForEach(predictions) { prediction in
                    Button(action: { onSelect(prediction) }, label: {
                        HStack(spacing: 12) {
                            // Location pin icon
                            Image(systemName: "mappin")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundColor(BrandColors.adobeBrick)
                                .frame(width: 20)

                            VStack(alignment: .leading, spacing: 2) {
                                Text(prediction.mainText)
                                    .font(Typography.predictionMain())
                                    .foregroundColor(BrandColors.midnightNavy)
                                    .lineLimit(1)

                                if let secondary = prediction.secondaryText {
                                    Text(secondary)
                                        .font(Typography.predictionSecondary())
                                        .foregroundColor(BrandColors.stormGray)
                                        .lineLimit(1)
                                }
                            }

                            Spacer()
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 14)
                        .padding(.horizontal, 16)
                    })
                    .buttonStyle(.plain)

                    if prediction.id != predictions.last?.id {
                        Divider()
                            .background(BrandColors.midnightNavy.opacity(0.1))
                            .padding(.leading, 48)
                    }
                }
            }
        }
        .frame(maxHeight: 250)
        .background(Color.white.opacity(0.75))
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(Color.white, lineWidth: 2)
        )
        .shadow(
            color: BrandColors.midnightNavy.opacity(0.15),
            radius: 20,
            x: 0,
            y: 8
        )
    }
}

// MARK: - Selected Place Display

private struct SelectedPlaceDisplay: View {
    let place: DetectedPlace
    let onChangePlace: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "mappin")
                .font(.system(size: 18, weight: .medium))
                .foregroundColor(BrandColors.adobeBrick)

            VStack(alignment: .leading, spacing: 2) {
                Text(place.name)
                    .font(Typography.semibold(16))
                    .foregroundColor(BrandColors.midnightNavy)
                    .lineLimit(1)

                if let address = place.address {
                    Text(address)
                        .font(Typography.body(14))
                        .foregroundColor(BrandColors.stormGray)
                        .lineLimit(1)
                }
            }

            Spacer()

            Button(action: onChangePlace) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 20))
                    .foregroundColor(BrandColors.stormGray.opacity(0.6))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Color.white.opacity(0.4))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.white.opacity(0.6), lineWidth: 1)
        )
    }
}

// MARK: - ViewModel

@MainActor
class LocationSearchViewModel: ObservableObject {
    @Published var searchText: String = ""
    @Published var predictions: [PlacePrediction] = []
    @Published var isSearching: Bool = false
    @Published var errorMessage: String?

    private let apiClient = APIClient()
    private var searchTask: Task<Void, Never>?
    private var debounceTask: Task<Void, Never>?

    #if DEBUG
    /// Mock predictions for testing (bypasses API calls)
    var mockPredictions: [PlacePrediction]?
    #endif

    func search(query: String, countryCode: String?) {
        NSLog("[Atlasi] search() called: query='%@' len=%d", query, query.count)

        // Cancel previous debounce
        debounceTask?.cancel()
        errorMessage = nil

        guard query.count >= 2 else {
            NSLog("[Atlasi] search() skipped: query too short (<2 chars)")
            predictions = []
            isSearching = false
            return
        }

        isSearching = true
        NSLog("[Atlasi] search() starting debounce...")

        // Debounce 300ms
        debounceTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)

            guard !Task.isCancelled else { return }

            await performSearch(query: query, countryCode: countryCode)
        }
    }

    private func performSearch(query: String, countryCode: String?) async {
        NSLog("[Atlasi] performSearch() starting for query='%@'", query)
        searchTask?.cancel()

        searchTask = Task {
            #if DEBUG
            // Use mock predictions if available (for test app)
            if let mockData = mockPredictions {
                let filtered = mockData.filter {
                    $0.mainText.localizedCaseInsensitiveContains(query) ||
                    ($0.secondaryText?.localizedCaseInsensitiveContains(query) ?? false)
                }
                predictions = filtered
                isSearching = false
                return
            }
            #endif

            do {
                NSLog("[Atlasi] Places search: query=%@, countryCode=%@", query, countryCode ?? "nil")
                let results = try await apiClient.searchPlaces(query: query, countryCode: countryCode)
                guard !Task.isCancelled else { return }
                NSLog("[Atlasi] Places search: %d results", results.count)
                predictions = results
                errorMessage = nil
            } catch let error as APIError {
                guard !Task.isCancelled else { return }
                predictions = []
                NSLog("[Atlasi] Places search error: \(error.localizedDescription)")
                switch error {
                case .noToken:
                    errorMessage = "Sign in to search places"
                case .unauthorized:
                    errorMessage = "Session expired"
                case .networkError:
                    errorMessage = "Network error"
                case .timeout:
                    errorMessage = "Request timed out"
                case .serverError(let code, _):
                    errorMessage = "Server error (\(code))"
                case .decodingError:
                    errorMessage = "Invalid response format"
                case .invalidURL:
                    errorMessage = "Invalid request"
                }
            } catch {
                guard !Task.isCancelled else { return }
                predictions = []
                errorMessage = "Search failed"
                NSLog("[Atlasi] Places search unexpected error: \(error.localizedDescription)")
            }
            isSearching = false
        }
    }

    func clearSearch() {
        searchText = ""
        predictions = []
        errorMessage = nil
        debounceTask?.cancel()
        searchTask?.cancel()
    }
}

#if DEBUG
struct LocationSearchView_Previews: PreviewProvider {
    static var previews: some View {
        LocationSearchView(
            selectedPlace: .constant(nil),
            countryCode: "US",
            onPlaceSelected: { _ in }
        )
        .padding()
        .background(BrandColors.warmCream)
    }
}
#endif

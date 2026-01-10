/**
 * LocationSearchView - Google Places autocomplete search
 */

import SwiftUI
import Combine

struct LocationSearchView: View {
    @Binding var selectedPlace: SelectedPlace?
    let countryCode: String?
    let onPlaceSelected: (SelectedPlace) -> Void

    @StateObject private var viewModel = LocationSearchViewModel()
    @State private var isEditing: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "Location")

            if let place = selectedPlace, !isEditing {
                // Selected place display
                SelectedPlaceDisplay(
                    place: place,
                    onChangePlace: {
                        isEditing = true
                        viewModel.searchText = ""
                    }
                )
            } else {
                // Search field and results
                VStack(spacing: 8) {
                    SearchField(
                        text: $viewModel.searchText,
                        placeholder: "Search for a place...",
                        isLoading: viewModel.isSearching
                    )
                    .onChange(of: viewModel.searchText) { newValue in
                        viewModel.search(query: newValue, countryCode: countryCode)
                    }

                    if !viewModel.predictions.isEmpty {
                        SearchResultsList(
                            predictions: viewModel.predictions,
                            onSelect: { prediction in
                                let place = SelectedPlace(from: prediction)
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

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 16))
                .foregroundColor(BrandColors.stormGray)

            TextField(placeholder, text: $text)
                .font(.system(size: 16))
                .foregroundColor(BrandColors.midnightNavy)

            if isLoading {
                ProgressView()
                    .scaleEffect(0.8)
            } else if !text.isEmpty {
                Button(action: { text = "" }) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 16))
                        .foregroundColor(BrandColors.stormGray)
                }
            }
        }
        .padding(16)
        .glassInput()
    }
}

// MARK: - Search Results List

private struct SearchResultsList: View {
    let predictions: [PlacePrediction]
    let onSelect: (PlacePrediction) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ForEach(predictions) { prediction in
                Button(action: { onSelect(prediction) }) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(prediction.mainText)
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(BrandColors.midnightNavy)
                            .lineLimit(1)

                        if let secondary = prediction.secondaryText {
                            Text(secondary)
                                .font(.system(size: 14))
                                .foregroundColor(BrandColors.stormGray)
                                .lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 12)
                    .padding(.horizontal, 16)
                }
                .buttonStyle(.plain)

                if prediction.id != predictions.last?.id {
                    Divider()
                        .padding(.leading, 16)
                }
            }
        }
        .background(Color.white.opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.white, lineWidth: 1.5)
        )
    }
}

// MARK: - Selected Place Display

private struct SelectedPlaceDisplay: View {
    let place: SelectedPlace
    let onChangePlace: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "mappin.circle.fill")
                .font(.system(size: 20))
                .foregroundColor(BrandColors.adobeBrick)

            VStack(alignment: .leading, spacing: 2) {
                Text(place.name)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(BrandColors.midnightNavy)
                    .lineLimit(1)

                if let address = place.address {
                    Text(address)
                        .font(.system(size: 14))
                        .foregroundColor(BrandColors.stormGray)
                        .lineLimit(1)
                }
            }

            Spacer()

            Button(action: onChangePlace) {
                Text("Change")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(BrandColors.stormGray)
            }
        }
        .padding(16)
        .glassInput()
    }
}

// MARK: - ViewModel

@MainActor
private class LocationSearchViewModel: ObservableObject {
    @Published var searchText: String = ""
    @Published var predictions: [PlacePrediction] = []
    @Published var isSearching: Bool = false

    private let apiClient = APIClient()
    private var searchTask: Task<Void, Never>?
    private var debounceTask: Task<Void, Never>?

    func search(query: String, countryCode: String?) {
        // Cancel previous debounce
        debounceTask?.cancel()

        guard query.count >= 2 else {
            predictions = []
            isSearching = false
            return
        }

        isSearching = true

        // Debounce 300ms
        debounceTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)

            guard !Task.isCancelled else { return }

            await performSearch(query: query, countryCode: countryCode)
        }
    }

    private func performSearch(query: String, countryCode: String?) async {
        searchTask?.cancel()

        searchTask = Task {
            do {
                let results = try await apiClient.searchPlaces(query: query, countryCode: countryCode)
                guard !Task.isCancelled else { return }
                predictions = results
            } catch {
                guard !Task.isCancelled else { return }
                predictions = []
            }
            isSearching = false
        }
    }

    func clearSearch() {
        searchText = ""
        predictions = []
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

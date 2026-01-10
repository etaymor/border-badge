/**
 * InlineTripFormView - Create a new trip inline
 */

import SwiftUI

struct InlineTripFormView: View {
    let countryCode: String?
    @ObservedObject var viewModel: TripSelectorViewModel
    let onTripCreated: (String) -> Void
    let onCancel: () -> Void

    @State private var tripName: String = ""
    @State private var selectedCountryCode: String = ""
    @State private var isShowingCountryPicker: Bool = false

    var canCreate: Bool {
        !tripName.trimmingCharacters(in: .whitespaces).isEmpty &&
        !selectedCountryCode.isEmpty
    }

    var body: some View {
        NavigationView {
            ZStack {
                BrandColors.warmCream.ignoresSafeArea()

                VStack(spacing: 24) {
                    // Trip name field
                    VStack(alignment: .leading, spacing: 12) {
                        SectionLabel(text: "Trip Name")

                        TextField("e.g., Summer in Italy", text: $tripName)
                            .font(.system(size: 16))
                            .foregroundColor(BrandColors.midnightNavy)
                            .padding(16)
                            .glassInput()
                    }

                    // Country selector
                    VStack(alignment: .leading, spacing: 12) {
                        SectionLabel(text: "Country")

                        Button(action: {
                            if countryCode == nil {
                                isShowingCountryPicker = true
                            }
                        }) {
                            HStack {
                                if let country = viewModel.country(for: selectedCountryCode) {
                                    Text(country.displayName)
                                        .font(.system(size: 16))
                                        .foregroundColor(BrandColors.midnightNavy)
                                } else {
                                    Text("Select a country...")
                                        .font(.system(size: 16))
                                        .foregroundColor(BrandColors.stormGray)
                                }

                                Spacer()

                                if countryCode == nil {
                                    Image(systemName: "chevron.down")
                                        .font(.system(size: 14, weight: .medium))
                                        .foregroundColor(BrandColors.stormGray)
                                } else {
                                    Image(systemName: "lock.fill")
                                        .font(.system(size: 14))
                                        .foregroundColor(BrandColors.stormGray.opacity(0.5))
                                }
                            }
                            .padding(16)
                            .glassInput()
                        }
                        .buttonStyle(.plain)
                        .disabled(countryCode != nil)
                    }

                    Spacer()

                    // Create button
                    Button(action: createTrip) {
                        if viewModel.isCreating {
                            ProgressView()
                                .tint(BrandColors.midnightNavy)
                        } else {
                            Text("Create Trip")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle(isEnabled: canCreate))
                    .disabled(!canCreate || viewModel.isCreating)
                }
                .padding(24)
            }
            .navigationTitle("New Trip")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel", action: onCancel)
                }
            }
            .sheet(isPresented: $isShowingCountryPicker) {
                CountryPickerView(
                    countries: viewModel.countries,
                    selectedCode: $selectedCountryCode,
                    onDismiss: { isShowingCountryPicker = false }
                )
            }
            .onAppear {
                // Lock to detected country if provided
                if let code = countryCode {
                    selectedCountryCode = code
                }
            }
        }
    }

    private func createTrip() {
        let name = tripName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty, !selectedCountryCode.isEmpty else { return }

        Task {
            if let trip = await viewModel.createTrip(name: name, countryCode: selectedCountryCode) {
                onTripCreated(trip.id)
            }
        }
    }
}

// MARK: - Country Picker

private struct CountryPickerView: View {
    let countries: [Country]
    @Binding var selectedCode: String
    let onDismiss: () -> Void

    @State private var searchText: String = ""

    var filteredCountries: [Country] {
        if searchText.isEmpty {
            return countries
        }
        return countries.filter {
            $0.name.localizedCaseInsensitiveContains(searchText) ||
            $0.code.localizedCaseInsensitiveContains(searchText)
        }
    }

    var body: some View {
        NavigationView {
            ZStack {
                BrandColors.warmCream.ignoresSafeArea()

                List(filteredCountries) { country in
                    Button(action: {
                        selectedCode = country.code
                        onDismiss()
                    }) {
                        HStack {
                            Text(country.displayName)
                                .font(.system(size: 16))
                                .foregroundColor(BrandColors.midnightNavy)

                            Spacer()

                            if country.code == selectedCode {
                                Image(systemName: "checkmark")
                                    .foregroundColor(BrandColors.mossGreen)
                            }
                        }
                    }
                    .listRowBackground(Color.clear)
                }
                .listStyle(.plain)
                .searchable(text: $searchText, prompt: "Search countries")
            }
            .navigationTitle("Select Country")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done", action: onDismiss)
                }
            }
        }
    }
}

#if DEBUG
struct InlineTripFormView_Previews: PreviewProvider {
    static var previews: some View {
        InlineTripFormView(
            countryCode: nil,
            viewModel: TripSelectorViewModel(),
            onTripCreated: { _ in },
            onCancel: {}
        )
    }
}
#endif

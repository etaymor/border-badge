/**
 * InlineTripFormView - Create a new trip inline
 *
 * Matches React Native InlineTripForm.tsx styling:
 * - Playfair Display Bold title
 * - Oswald section labels
 * - Glass inputs with Open Sans text
 * - Sunset Gold create button
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

    /// Is the country locked from place detection
    var isCountryLocked: Bool {
        countryCode != nil
    }

    var body: some View {
        ZStack {
            BrandColors.warmCream.ignoresSafeArea()

            VStack(spacing: 0) {
                // Title - Playfair Display Bold
                Text("Create New Trip")
                    .font(Typography.header(22))
                    .foregroundColor(BrandColors.midnightNavy)
                    .padding(.top, 24)
                    .padding(.bottom, 20)

                // Trip name field
                VStack(alignment: .leading, spacing: 8) {
                    SectionLabel(text: "Trip Name")

                    TextField("e.g., Summer in Italy", text: $tripName)
                        .font(Typography.body(16))
                        .foregroundColor(BrandColors.midnightNavy)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .background(Color.white.opacity(0.4))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Color.white.opacity(0.6), lineWidth: 1)
                        )
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 20)

                // Country selector
                VStack(alignment: .leading, spacing: 8) {
                    SectionLabel(text: "Country")

                    if isCountryLocked {
                        // Locked country (from place detection)
                        if let country = viewModel.country(for: selectedCountryCode) {
                            HStack(spacing: 10) {
                                Text(country.flag)
                                    .font(.system(size: 20))

                                Text(country.name)
                                    .font(Typography.semibold(16))
                                    .foregroundColor(BrandColors.midnightNavy)

                                Spacer()
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
                    } else {
                        // Selectable country
                        Button(
                            action: { isShowingCountryPicker = true },
                            label: {
                            HStack {
                                if let country = viewModel.country(for: selectedCountryCode) {
                                    HStack(spacing: 10) {
                                        Text(country.flag)
                                            .font(.system(size: 20))

                                        Text(country.name)
                                            .font(Typography.semibold(16))
                                            .foregroundColor(BrandColors.midnightNavy)
                                    }
                                } else {
                                    Text("Select a country...")
                                        .font(Typography.body(16))
                                        .foregroundColor(BrandColors.stormGray)
                                }

                                Spacer()

                                Image(systemName: "chevron.forward")
                                    .font(.system(size: 20))
                                    .foregroundColor(BrandColors.stormGray)
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 12)
                            .background(Color.white.opacity(0.4))
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(Color.white.opacity(0.6), lineWidth: 1)
                            )
                        })
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 24)

                Spacer()

                // Create button - Sunset Gold
                Button(action: createTrip) {
                    if viewModel.isCreating {
                        ProgressView()
                            .tint(BrandColors.midnightNavy)
                    } else {
                        Text("Create Trip")
                            .font(Typography.semibold(16))
                            .foregroundColor(BrandColors.midnightNavy)
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(canCreate ? BrandColors.sunsetGold : BrandColors.sunsetGold.opacity(0.5))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .shadow(
                    color: canCreate ? BrandColors.sunsetGold.opacity(0.3) : Color.clear,
                    radius: 8, x: 0, y: 4
                )
                .disabled(!canCreate || viewModel.isCreating)
                .padding(.horizontal, 24)
                .padding(.top, 8)

                // Cancel Button
                Button(action: onCancel) {
                    Text("Cancel")
                        .font(Typography.semibold(16))
                        .foregroundColor(BrandColors.stormGray)
                        .frame(height: 48)
                }
                .padding(.bottom, 24)
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

// MARK: - Country Row

private struct CountryRow: View {
    let country: Country
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                Text(country.flag)
                    .font(.system(size: 20))

                Text(country.name)
                    .font(isSelected ? Typography.semibold(15) : Typography.body(15))
                    .foregroundColor(isSelected ? BrandColors.mossGreen : BrandColors.midnightNavy)
                    .lineLimit(1)

                Spacer()

                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 20))
                        .foregroundColor(BrandColors.mossGreen)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(isSelected ? BrandColors.mossGreen.opacity(0.1) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
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
        ZStack {
            BrandColors.warmCream.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header with back button
                HStack {
                    Button(action: onDismiss) {
                        Image(systemName: "arrow.left")
                            .font(.system(size: 24))
                            .foregroundColor(BrandColors.midnightNavy)
                    }

                    Spacer()

                    Text("Select Country")
                        .font(Typography.header(22))
                        .foregroundColor(BrandColors.midnightNavy)

                    Spacer()

                    // Spacer to balance header
                    Color.clear.frame(width: 24, height: 24)
                }
                .padding(.horizontal, 24)
                .padding(.top, 16)
                .padding(.bottom, 16)

                // Country list
                ScrollView {
                    LazyVStack(spacing: 4) {
                        ForEach(filteredCountries) { country in
                            CountryRow(
                                country: country,
                                isSelected: country.code == selectedCode,
                                onTap: {
                                    selectedCode = country.code
                                    onDismiss()
                                }
                            )
                        }
                    }
                    .padding(.horizontal, 24)
                }
            }
        }
        .searchable(text: $searchText, prompt: "Search countries")
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

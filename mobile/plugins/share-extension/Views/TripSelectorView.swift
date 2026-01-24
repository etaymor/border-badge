/**
 * TripSelectorView - Trip selection dropdown with inline creation
 *
 * Matches React Native TripSelector.tsx styling:
 * - Glass dropdown button (52px min height)
 * - Playfair modal title, Open Sans body text
 * - Sunset Gold "Create New Trip" button
 * - Glass-styled trip items with mossGreen selection
 */

import SwiftUI

/// Tracks which sheet is currently being presented
private enum ActiveSheet: Identifiable {
    case selection
    case create

    var id: Int { hashValue }
}

struct TripSelectorView: View {
    @Binding var selectedTripId: String?
    let countryCode: String?
    @ObservedObject var viewModel: TripSelectorViewModel
    let onTripSelected: (String) -> Void

    @State private var activeSheet: ActiveSheet?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "Save to Trip")

            Button(action: {
                // Always show selection sheet - it includes Saved Places option
                activeSheet = .selection
            }) {
                HStack(spacing: 8) {
                    // Check if selected trip is the uncategorized "Saved Places" trip
                    if let tripId = selectedTripId,
                       let uncategorized = viewModel.uncategorizedTrip,
                       tripId == uncategorized.id {
                        // Show bookmark icon for Saved Places
                        Image(systemName: "bookmark.fill")
                            .font(.system(size: 18))
                            .foregroundColor(BrandColors.sunsetGold)

                        Text("Saved Places")
                            .font(Typography.semibold(16))
                            .foregroundColor(BrandColors.midnightNavy)
                            .lineLimit(1)

                        Spacer()
                    } else if let tripId = selectedTripId,
                       let trip = viewModel.trips.first(where: { $0.id == tripId }) {
                        // Selected trip name + country code
                        Text(trip.name)
                            .font(Typography.semibold(16))
                            .foregroundColor(BrandColors.midnightNavy)
                            .lineLimit(1)

                        Spacer()

                        if let code = trip.countryCode {
                            Text(code)
                                .font(Typography.body(14))
                                .foregroundColor(BrandColors.stormGray)
                        }
                    } else {
                        Text("Select a trip...")
                            .font(Typography.body(16))
                            .foregroundColor(BrandColors.stormGray)

                        Spacer()
                    }

                    Image(systemName: "chevron.down")
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
            }
            .buttonStyle(.plain)
        }
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .selection:
                if #available(iOS 16.0, *) {
                    TripSelectionSheet(
                        selectedTripId: $selectedTripId,
                        countryCode: countryCode,
                        viewModel: viewModel,
                        onTripSelected: { tripId in
                            onTripSelected(tripId)
                            activeSheet = nil
                        },
                        onCreateTrip: {
                            activeSheet = .create
                        },
                        onDismiss: {
                            activeSheet = nil
                        }
                    )
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
                } else {
                    TripSelectionSheet(
                        selectedTripId: $selectedTripId,
                        countryCode: countryCode,
                        viewModel: viewModel,
                        onTripSelected: { tripId in
                            onTripSelected(tripId)
                            activeSheet = nil
                        },
                        onCreateTrip: {
                            activeSheet = .create
                        },
                        onDismiss: {
                            activeSheet = nil
                        }
                    )
                }

            case .create:
                if #available(iOS 16.0, *) {
                    InlineTripFormView(
                        countryCode: countryCode,
                        viewModel: viewModel,
                        onTripCreated: { tripId in
                            selectedTripId = tripId
                            onTripSelected(tripId)
                            activeSheet = nil
                        },
                        onCancel: {
                            activeSheet = nil
                        }
                    )
                    .presentationDetents([.medium])
                    .presentationDragIndicator(.visible)
                } else {
                    InlineTripFormView(
                        countryCode: countryCode,
                        viewModel: viewModel,
                        onTripCreated: { tripId in
                            selectedTripId = tripId
                            onTripSelected(tripId)
                            activeSheet = nil
                        },
                        onCancel: {
                            activeSheet = nil
                        }
                    )
                }
            }
        }
        .onAppear {
            // Always load to ensure uncategorized trip is fetched
            if viewModel.trips.isEmpty || viewModel.uncategorizedTrip == nil {
                viewModel.load()
            }
        }
        .onChange(of: viewModel.trips) { _ in
            // Auto-select trip when trips load
            autoSelectTrip()
        }
        .onChange(of: viewModel.uncategorizedTrip) { newValue in
            // Auto-select when uncategorized trip loads (may load after trips)
            if newValue != nil {
                autoSelectTrip()
            }
        }
        .onChange(of: viewModel.isLoading) { isLoading in
            // Auto-select after loading completes
            if !isLoading {
                autoSelectTrip()
            }
        }
    }

    /// Auto-select the best trip: country-specific trip first, then uncategorized ("Saved Places")
    private func autoSelectTrip() {
        guard selectedTripId == nil else { return }

        let filtered = viewModel.filteredTrips(countryCode: countryCode)
        if let firstTrip = filtered.first {
            // Select the most recent trip for the detected country
            selectedTripId = firstTrip.id
            onTripSelected(firstTrip.id)
        } else if let uncategorized = viewModel.uncategorizedTrip {
            // Default to "Saved Places" when no matching trips
            selectedTripId = uncategorized.id
            onTripSelected(uncategorized.id)
        }
    }
}

// MARK: - Trip Selection Sheet

private struct TripSelectionSheet: View {
    @Binding var selectedTripId: String?
    let countryCode: String?
    @ObservedObject var viewModel: TripSelectorViewModel
    let onTripSelected: (String) -> Void
    let onCreateTrip: () -> Void
    let onDismiss: () -> Void

    var filteredTrips: [Trip] {
        viewModel.filteredTrips(countryCode: countryCode)
    }

    var body: some View {
        ZStack {
            BrandColors.warmCream.ignoresSafeArea()

            VStack(spacing: 0) {
                // Title - Playfair Display Bold
                Text("Select Trip")
                    .font(Typography.header(22))
                    .foregroundColor(BrandColors.midnightNavy)
                    .padding(.top, 24)
                    .padding(.bottom, 20)

                if viewModel.isLoading {
                    Spacer()
                    ProgressView()
                        .tint(BrandColors.sunsetGold)
                    Spacer()
                } else {
                    // Trip list with Saved Places option
                    ScrollView {
                        VStack(spacing: 8) {
                            // Saved Places option (always shown first)
                            if let uncategorized = viewModel.uncategorizedTrip {
                                SavedPlacesRow(
                                    isSelected: selectedTripId == uncategorized.id,
                                    onTap: { onTripSelected(uncategorized.id) }
                                )

                                // Divider if there are country trips
                                if !filteredTrips.isEmpty {
                                    HStack {
                                        Rectangle()
                                            .fill(Color.black.opacity(0.1))
                                            .frame(height: 1)
                                        Text("or add to a trip")
                                            .font(Typography.body(12))
                                            .foregroundColor(BrandColors.stormGray)
                                        Rectangle()
                                            .fill(Color.black.opacity(0.1))
                                            .frame(height: 1)
                                    }
                                    .padding(.vertical, 12)
                                }
                            }

                            // Country-specific trips
                            ForEach(filteredTrips) { trip in
                                TripRow(
                                    trip: trip,
                                    isSelected: trip.id == selectedTripId,
                                    onTap: { onTripSelected(trip.id) }
                                )
                            }
                        }
                        .padding(.horizontal, 24)
                    }
                    .frame(maxHeight: 300)
                }

                // Create New Trip Button - Sunset Gold
                Button(action: onCreateTrip) {
                    HStack(spacing: 8) {
                        // Plus icon in circle
                        ZStack {
                            Circle()
                                .fill(Color.black.opacity(0.1))
                                .frame(width: 24, height: 24)

                            Image(systemName: "plus")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(.white)
                        }

                        Text("Create New Trip")
                            .font(Typography.semibold(16))
                            .foregroundColor(BrandColors.midnightNavy)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(BrandColors.sunsetGold)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .shadow(color: BrandColors.sunsetGold.opacity(0.3), radius: 8, x: 0, y: 4)
                }
                .padding(.horizontal, 24)
                .padding(.top, 16)

                // Cancel Button
                Button(action: onDismiss) {
                    Text("Cancel")
                        .font(Typography.semibold(16))
                        .foregroundColor(BrandColors.stormGray)
                        .frame(height: 48)
                }
                .padding(.bottom, 24)
            }
        }
    }
}

// MARK: - Saved Places Row

private struct SavedPlacesRow: View {
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 8) {
                // Bookmark icon
                Image(systemName: "bookmark.fill")
                    .font(.system(size: 18))
                    .foregroundColor(BrandColors.sunsetGold)

                // Label
                Text("Saved Places")
                    .font(Typography.semibold(15))
                    .foregroundColor(isSelected ? BrandColors.mossGreen : BrandColors.midnightNavy)

                // Hint
                Text("Organize later")
                    .font(Typography.body(12))
                    .foregroundColor(BrandColors.stormGray)

                Spacer()

                // Checkmark when selected
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 22))
                        .foregroundColor(BrandColors.mossGreen)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(
                isSelected
                    ? Color(red: 84/255, green: 122/255, blue: 95/255).opacity(0.15)  // mossGreen 0.15
                    : BrandColors.sunsetGold.opacity(0.15)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(
                        isSelected ? BrandColors.mossGreen : BrandColors.sunsetGold.opacity(0.3),
                        lineWidth: 1
                    )
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Trip Row

private struct TripRow: View {
    let trip: Trip
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 8) {
                // Trip name
                Text(trip.name)
                    .font(Typography.semibold(15))
                    .foregroundColor(isSelected ? BrandColors.mossGreen : BrandColors.midnightNavy)
                    .lineLimit(1)

                Spacer()

                // Country code
                if let code = trip.countryCode {
                    Text(code)
                        .font(Typography.body(13))
                        .foregroundColor(BrandColors.stormGray)
                }

                // Checkmark when selected
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 22))
                        .foregroundColor(BrandColors.mossGreen)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(
                isSelected
                    ? Color(red: 84/255, green: 122/255, blue: 95/255).opacity(0.15)  // mossGreen 0.15
                    : Color.white.opacity(0.4)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(
                        isSelected ? BrandColors.mossGreen : Color.white.opacity(0.4),
                        lineWidth: 1
                    )
            )
        }
        .buttonStyle(.plain)
    }
}

#if DEBUG
struct TripSelectorView_Previews: PreviewProvider {
    static var previews: some View {
        TripSelectorView(
            selectedTripId: .constant(nil),
            countryCode: "US",
            viewModel: TripSelectorViewModel(),
            onTripSelected: { _ in }
        )
        .padding()
        .background(BrandColors.warmCream)
    }
}
#endif

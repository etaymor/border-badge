/**
 * TripSelectorView - Trip selection dropdown with inline creation
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
            SectionLabel(text: "Trip")

            Button(action: { activeSheet = .selection }) {
                HStack(spacing: 12) {
                    Image(systemName: "suitcase.fill")
                        .font(.system(size: 16))
                        .foregroundColor(BrandColors.mossGreen)

                    if let tripId = selectedTripId,
                       let trip = viewModel.trips.first(where: { $0.id == tripId }) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(trip.name)
                                .font(.system(size: 16, weight: .medium))
                                .foregroundColor(BrandColors.midnightNavy)

                            if let code = trip.countryCode {
                                Text(viewModel.countryName(for: code))
                                    .font(.system(size: 14))
                                    .foregroundColor(BrandColors.stormGray)
                            }
                        }
                    } else {
                        Text("Select a trip...")
                            .font(.system(size: 16))
                            .foregroundColor(BrandColors.stormGray)
                    }

                    Spacer()

                    Image(systemName: "chevron.down")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(BrandColors.stormGray)
                }
                .padding(16)
                .glassInput()
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
            if viewModel.trips.isEmpty {
                viewModel.load()
            }
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
        NavigationView {
            ZStack {
                BrandColors.warmCream.ignoresSafeArea()

                if viewModel.isLoading {
                    ProgressView()
                } else if filteredTrips.isEmpty {
                    // No trips for this country
                    VStack(spacing: 16) {
                        Image(systemName: "suitcase")
                            .font(.system(size: 48))
                            .foregroundColor(BrandColors.stormGray)

                        Text("No trips yet")
                            .font(.system(size: 18, weight: .medium))
                            .foregroundColor(BrandColors.midnightNavy)

                        Text("Create a trip to save this place")
                            .font(.system(size: 14))
                            .foregroundColor(BrandColors.stormGray)

                        Button(action: onCreateTrip) {
                            HStack {
                                Image(systemName: "plus")
                                Text("Create Trip")
                            }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .padding(.horizontal, 40)
                        .padding(.top, 8)
                    }
                } else {
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(filteredTrips) { trip in
                                TripRow(
                                    trip: trip,
                                    isSelected: trip.id == selectedTripId,
                                    countryName: trip.countryCode.map { viewModel.countryName(for: $0) },
                                    onTap: { onTripSelected(trip.id) }
                                )

                                if trip.id != filteredTrips.last?.id {
                                    Divider()
                                        .padding(.leading, 56)
                                }
                            }
                        }
                        .padding(.horizontal)
                    }
                }
            }
            .navigationTitle("Select Trip")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel", action: onDismiss)
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: onCreateTrip) {
                        Image(systemName: "plus")
                    }
                }
            }
        }
    }
}

// MARK: - Trip Row

private struct TripRow: View {
    let trip: Trip
    let isSelected: Bool
    let countryName: String?
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 24))
                    .foregroundColor(isSelected ? BrandColors.mossGreen : BrandColors.stormGray.opacity(0.5))

                VStack(alignment: .leading, spacing: 4) {
                    Text(trip.name)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(BrandColors.midnightNavy)

                    if let country = countryName {
                        Text(country)
                            .font(.system(size: 14))
                            .foregroundColor(BrandColors.stormGray)
                    }
                }

                Spacer()
            }
            .padding(.vertical, 16)
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

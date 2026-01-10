/**
 * CaptureFormView - Main form for capturing place details
 */

import SwiftUI

struct CaptureFormView: View {
    @ObservedObject var viewModel: ShareCaptureViewModel
    @ObservedObject var tripViewModel: TripSelectorViewModel
    let onSave: () -> Void
    let onCancel: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Header
                HeaderView(
                    providerName: viewModel.providerName,
                    title: viewModel.ingestResult?.title,
                    isManualEntry: viewModel.isManualEntryMode
                )

                // Location search
                LocationSearchView(
                    selectedPlace: $viewModel.selectedPlace,
                    countryCode: viewModel.detectedCountryCode,
                    onPlaceSelected: { place in
                        viewModel.selectPlace(place)
                    }
                )

                // Trip selector
                TripSelectorView(
                    selectedTripId: $viewModel.selectedTripId,
                    countryCode: viewModel.detectedCountryCode,
                    viewModel: tripViewModel,
                    onTripSelected: { tripId in
                        viewModel.selectedTripId = tripId
                    }
                )

                // Category selector
                CategorySelectorView(
                    entryType: viewModel.entryType,
                    hasSelectedType: viewModel.hasSelectedType,
                    onTypeSelect: { type in
                        viewModel.selectEntryType(type)
                    },
                    onChangeType: {
                        viewModel.resetEntryType()
                    }
                )

                // Notes field
                NotesField(notes: $viewModel.notes)

                // Save button
                Button(action: onSave) {
                    Text("Save to Trip")
                }
                .buttonStyle(PrimaryButtonStyle(isEnabled: viewModel.canSave))
                .disabled(!viewModel.canSave)

                // Cancel button
                Button(action: onCancel) {
                    Text("Cancel")
                        .font(.system(size: 15, weight: .regular))
                        .foregroundColor(BrandColors.stormGray)
                }
            }
            .padding(20)
        }
    }
}

// MARK: - Header View

private struct HeaderView: View {
    let providerName: String
    let title: String?
    let isManualEntry: Bool

    var body: some View {
        VStack(spacing: 8) {
            Text("Save Place")
                .font(.system(size: 24, weight: .bold))
                .foregroundColor(BrandColors.midnightNavy)

            if isManualEntry {
                Text("Enter details manually")
                    .font(.system(size: 14))
                    .foregroundColor(BrandColors.stormGray)
            } else if let title = title {
                Text(title)
                    .font(.system(size: 14))
                    .foregroundColor(BrandColors.stormGray)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
            } else {
                Text("From \(providerName)")
                    .font(.system(size: 14))
                    .foregroundColor(BrandColors.stormGray)
            }
        }
        .padding(.bottom, 8)
    }
}

// MARK: - Notes Field

private struct NotesField: View {
    @Binding var notes: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "Notes (optional)")

            TextField("Add a note...", text: $notes, axis: .vertical)
                .font(.system(size: 16))
                .foregroundColor(BrandColors.midnightNavy)
                .lineLimit(3...6)
                .padding(16)
                .glassInput()
        }
    }
}

#if DEBUG
struct CaptureFormView_Previews: PreviewProvider {
    static var previews: some View {
        CaptureFormView(
            viewModel: ShareCaptureViewModel(),
            tripViewModel: TripSelectorViewModel(),
            onSave: {},
            onCancel: {}
        )
        .background(BrandColors.warmCream)
    }
}
#endif

/**
 * CaptureFormView - Main form for capturing place details
 */

import SwiftUI

struct CaptureFormView: View {
    @ObservedObject var viewModel: ShareCaptureViewModel
    @ObservedObject var tripViewModel: TripSelectorViewModel
    var locationViewModel: LocationSearchViewModel?
    let onSave: () -> Void
    let onCancel: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Header card with close button
                HeaderCard(
                    providerName: viewModel.providerName,
                    title: viewModel.ingestResult?.title,
                    isManualEntry: viewModel.isManualEntryMode,
                    onClose: onCancel
                )

                // Location search
                LocationSearchView(
                    selectedPlace: $viewModel.selectedPlace,
                    countryCode: viewModel.detectedCountryCode,
                    onPlaceSelected: { place in
                        viewModel.selectPlace(place)
                    },
                    viewModel: locationViewModel
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
            }
            .padding(20)
        }
    }
}

// MARK: - Header Card

private struct HeaderCard: View {
    let providerName: String
    let title: String?
    let isManualEntry: Bool
    let onClose: () -> Void

    @State private var isExpanded: Bool = false

    var body: some View {
        HStack {
            Spacer()

            VStack(spacing: 8) {
                Text("Save Place")
                    .font(Typography.header(24))
                    .foregroundColor(BrandColors.midnightNavy)

                if isManualEntry {
                    Text("Enter details manually")
                        .font(Typography.body(14))
                        .foregroundColor(BrandColors.stormGray)
                } else if let title = title {
                    VStack(spacing: 4) {
                        Text(title)
                            .font(Typography.body(14))
                            .foregroundColor(BrandColors.stormGray)
                            .lineLimit(isExpanded ? nil : 2)
                            .multilineTextAlignment(.center)

                        Button(action: {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                isExpanded.toggle()
                            }
                        }) {
                            HStack(spacing: 4) {
                                Text(isExpanded ? "Show less" : "Show more")
                                    .font(Typography.body(12))
                                Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                                    .font(.system(size: 10, weight: .medium))
                            }
                            .foregroundColor(BrandColors.sunsetGold)
                        }
                    }
                } else {
                    Text("From \(providerName)")
                        .font(Typography.body(14))
                        .foregroundColor(BrandColors.stormGray)
                }
            }

            Spacer()
        }
        .padding(.vertical, 16)
        .overlay(alignment: .topTrailing) {
            // Close button in top right
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(BrandColors.midnightNavy)
                    .frame(width: 32, height: 32)
                    .background(
                        Circle()
                            .fill(BrandColors.stormGray.opacity(0.15))
                    )
            }
        }
    }
}

// MARK: - Notes Field

private struct NotesField: View {
    @Binding var notes: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "Notes (optional)")

            if #available(iOS 16.0, *) {
                TextField("Why did this catch your eye?", text: $notes, axis: .vertical)
                    .font(Typography.body(16))
                    .foregroundColor(BrandColors.midnightNavy)
                    .lineLimit(3...6)
                    .padding(16)
                    .frame(minHeight: 100)
                    .glassInput()
            } else {
                // Fallback for iOS 15 where multiline TextField axis API is unavailable
                TextEditor(text: $notes)
                    .font(Typography.body(16))
                    .foregroundColor(BrandColors.midnightNavy)
                    .frame(minHeight: 100, maxHeight: 140)
                    .padding(16)
                    .glassInput()
            }
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

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
                    countryCode: viewModel.effectiveCountryCode,
                    onPlaceSelected: { place in
                        viewModel.selectPlace(place)
                    },
                    onPlaceCleared: {
                        viewModel.clearPlace()
                    },
                    viewModel: locationViewModel
                )

                // Trip selector
                TripSelectorView(
                    selectedTripId: $viewModel.selectedTripId,
                    countryCode: viewModel.effectiveCountryCode,
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
    @State private var isTruncated: Bool = false

    var body: some View {
        content
            .onChange(of: title) { _ in
                // Reset expand/truncate state when title changes
                isExpanded = false
                isTruncated = false
            }
    }

    private var content: some View {
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
                            .background(
                                // Hidden view to measure if text is truncated
                                TruncationDetector(
                                    text: title,
                                    lineLimit: 2,
                                    isTruncated: $isTruncated
                                )
                            )

                        if isTruncated || isExpanded {
                            Button(
                                action: {
                                    withAnimation(.easeInOut(duration: 0.2)) {
                                        isExpanded.toggle()
                                    }
                                },
                                label: {
                                    HStack(spacing: 4) {
                                        Text(isExpanded ? "Show less" : "Show more")
                                            .font(Typography.body(12))
                                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                                            .font(.system(size: 10, weight: .medium))
                                    }
                                    .foregroundColor(BrandColors.sunsetGold)
                                }
                            )
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

// MARK: - Truncation Detector

/// A hidden view that measures whether text would be truncated at a given line limit
private struct TruncationDetector: View {
    let text: String
    let lineLimit: Int
    @Binding var isTruncated: Bool

    @State private var fullHeight: CGFloat = 0
    @State private var truncatedHeight: CGFloat = 0

    var body: some View {
        // Measure full height (unlimited lines)
        Text(text)
            .font(Typography.body(14))
            .lineLimit(nil)
            .fixedSize(horizontal: false, vertical: true)
            .hidden()
            .accessibilityHidden(true)
            .background(
                GeometryReader { geometry in
                    Color.clear.preference(key: FullHeightKey.self, value: geometry.size.height)
                }
            )
            .background(
                // Measure truncated height (limited lines)
                Text(text)
                    .font(Typography.body(14))
                    .lineLimit(lineLimit)
                    .hidden()
                    .accessibilityHidden(true)
                    .background(
                        GeometryReader { geometry in
                            Color.clear.preference(key: TruncatedHeightKey.self, value: geometry.size.height)
                        }
                    )
            )
            .onPreferenceChange(FullHeightKey.self) { height in
                fullHeight = height
                updateTruncation()
            }
            .onPreferenceChange(TruncatedHeightKey.self) { height in
                truncatedHeight = height
                updateTruncation()
            }
    }

    private func updateTruncation() {
        let newValue = fullHeight > truncatedHeight
        // Guard against redundant state updates
        if newValue != isTruncated {
            isTruncated = newValue
        }
    }
}

// Preference keys for height measurement
private struct FullHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private struct TruncatedHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
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

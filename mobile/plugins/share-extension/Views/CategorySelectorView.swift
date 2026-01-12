/**
 * CategorySelectorView - Entry type selection grid
 *
 * Matches the React Native app's category selector:
 * - 2x2 grid with vertical icon+label layout when selecting
 * - Compact pill with Change button when selected
 */

import SwiftUI

struct CategorySelectorView: View {
    let entryType: EntryType
    let hasSelectedType: Bool
    let onTypeSelect: (EntryType) -> Void
    let onChangeType: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "Category")

            if hasSelectedType {
                // Compact selected state
                SelectedCategoryDisplay(
                    entryType: entryType,
                    onChangeType: onChangeType
                )
            } else {
                // Grid of category buttons
                CategoryGrid(
                    selectedType: entryType,
                    onTypeSelect: onTypeSelect
                )
            }
        }
    }
}

// MARK: - Category Grid

private struct CategoryGrid: View {
    let selectedType: EntryType
    let onTypeSelect: (EntryType) -> Void

    private let columns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12)
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 12) {
            ForEach(EntryType.allCases, id: \.self) { type in
                CategoryButton(
                    type: type,
                    isSelected: false,  // Don't show selection in grid - user taps to select
                    onTap: { onTypeSelect(type) }
                )
            }
        }
    }
}

// MARK: - Category Button

private struct CategoryButton: View {
    let type: EntryType
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 10) {
                // Icon in circle
                ZStack {
                    Circle()
                        .fill(type.color.opacity(0.15))
                        .frame(width: 44, height: 44)

                    Image(systemName: type.icon)
                        .font(.system(size: 20, weight: .medium))
                        .foregroundColor(type.color)
                }

                // Label
                Text(type.label)
                    .font(Typography.body(14))
                    .foregroundColor(BrandColors.midnightNavy)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(Color.white.opacity(0.7))
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(isSelected ? type.color : Color.clear, lineWidth: 2)
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Selected Category Display

private struct SelectedCategoryDisplay: View {
    let entryType: EntryType
    let onChangeType: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            // Icon in small circle
            ZStack {
                Circle()
                    .fill(entryType.color.opacity(0.15))
                    .frame(width: 32, height: 32)

                Image(systemName: entryType.icon)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(entryType.color)
            }

            // Label
            Text(entryType.label)
                .font(Typography.semibold(16))
                .foregroundColor(BrandColors.midnightNavy)

            Spacer()

            // Change button with swap arrows
            Button(action: onChangeType) {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.left.arrow.right")
                        .font(.system(size: 12, weight: .medium))
                    Text("Change")
                        .font(Typography.body(14))
                }
                .foregroundColor(BrandColors.stormGray)
            }
        }
        .padding(16)
        .background(entryType.color.opacity(0.08))
        .glassInput()
    }
}

#if DEBUG
struct CategorySelectorView_Previews: PreviewProvider {
    static var previews: some View {
        VStack(spacing: 24) {
            CategorySelectorView(
                entryType: .food,
                hasSelectedType: false,
                onTypeSelect: { _ in },
                onChangeType: {}
            )

            CategorySelectorView(
                entryType: .food,
                hasSelectedType: true,
                onTypeSelect: { _ in },
                onChangeType: {}
            )
        }
        .padding()
        .background(BrandColors.warmCream)
    }
}
#endif

/**
 * CategorySelectorView - Entry type selection grid
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
                    isSelected: type == selectedType,
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
            HStack(spacing: 8) {
                Image(systemName: type.icon)
                    .font(.system(size: 16, weight: .medium))

                Text(type.label)
                    .font(.system(size: 14, weight: .medium))
            }
            .foregroundColor(isSelected ? .white : BrandColors.midnightNavy)
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .background(isSelected ? type.color : Color.white.opacity(0.5))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isSelected ? Color.clear : Color.white, lineWidth: 1.5)
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
            // Icon and label
            HStack(spacing: 8) {
                Image(systemName: entryType.icon)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(entryType.color)

                Text(entryType.label)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(BrandColors.midnightNavy)
            }

            Spacer()

            // Change button
            Button(action: onChangeType) {
                Text("Change")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(BrandColors.stormGray)
            }
        }
        .padding(16)
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

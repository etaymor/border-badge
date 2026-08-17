/**
 * SectionLabel - Consistent section header styling
 */

import SwiftUI

struct SectionLabel: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(Typography.sectionLabel())
            .tracking(1.5)
            .foregroundColor(BrandColors.midnightNavy.opacity(0.7))
    }
}

/**
 * LoadingStateView - Loading indicator for share extension
 */

import SwiftUI

struct LoadingStateView: View {
    let message: String
    var providerName: String? = nil

    var body: some View {
        VStack(spacing: 20) {
            ProgressView()
                .scaleEffect(1.2)
                .tint(BrandColors.midnightNavy)

            Text(message)
                .font(.system(size: 16, weight: .medium))
                .foregroundColor(BrandColors.midnightNavy)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(40)
    }
}

#if DEBUG
struct LoadingStateView_Previews: PreviewProvider {
    static var previews: some View {
        LoadingStateView(message: "Processing TikTok link...")
            .background(BrandColors.warmCream)
    }
}
#endif

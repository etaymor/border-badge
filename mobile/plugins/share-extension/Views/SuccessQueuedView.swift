/**
 * SuccessQueuedView - Shows success with queued/deferred save message
 *
 * Displayed when a save was queued for later processing instead of
 * completing immediately (e.g., due to network issues or auth state).
 */

import SwiftUI

struct SuccessQueuedView: View {
    let reason: ShareCaptureState.QueueReason
    let onDismiss: () -> Void

    @State private var iconScale: CGFloat = 0.5
    @State private var contentOpacity: Double = 0

    var body: some View {
        VStack(spacing: 20) {
            // Clock with checkmark icon (indicates saved for later)
            Image(systemName: "clock.badge.checkmark.fill")
                .font(.system(size: 64))
                .foregroundColor(BrandColors.mossGreen)
                .scaleEffect(iconScale)
                .opacity(contentOpacity)

            VStack(spacing: 8) {
                Text("Saved for Later")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(BrandColors.midnightNavy)

                Text(reason.message)
                    .font(.system(size: 15, weight: .regular))
                    .foregroundColor(BrandColors.midnightNavy.opacity(0.6))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }
            .opacity(contentOpacity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            // Animate content in
            withAnimation(.spring(response: 0.4, dampingFraction: 0.6)) {
                iconScale = 1.0
                contentOpacity = 1.0
            }

            // Haptic feedback (softer than immediate success)
            let generator = UINotificationFeedbackGenerator()
            generator.notificationOccurred(.warning)

            // Auto-dismiss after 2.5 seconds (longer to read message)
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
                onDismiss()
            }
        }
    }
}

#if DEBUG
struct SuccessQueuedView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            SuccessQueuedView(reason: .networkError, onDismiss: {})
                .background(BrandColors.warmCream)
                .previewDisplayName("Network Error")

            SuccessQueuedView(reason: .serverError, onDismiss: {})
                .background(BrandColors.warmCream)
                .previewDisplayName("Server Error")

            SuccessQueuedView(reason: .unauthenticated, onDismiss: {})
                .background(BrandColors.warmCream)
                .previewDisplayName("Unauthenticated")
        }
    }
}
#endif

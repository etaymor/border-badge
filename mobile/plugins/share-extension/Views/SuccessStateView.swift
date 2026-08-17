/**
 * SuccessStateView - Success confirmation with auto-dismiss
 */

import SwiftUI

struct SuccessStateView: View {
    let onDismiss: () -> Void

    @State private var checkmarkScale: CGFloat = 0.5
    @State private var checkmarkOpacity: Double = 0

    var body: some View {
        VStack(spacing: 20) {
            // Animated checkmark
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 64))
                .foregroundColor(BrandColors.mossGreen)
                .scaleEffect(checkmarkScale)
                .opacity(checkmarkOpacity)

            Text("Saved!")
                .font(Typography.header(24))
                .foregroundColor(BrandColors.midnightNavy)
                .opacity(checkmarkOpacity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            // Animate checkmark
            withAnimation(.spring(response: 0.4, dampingFraction: 0.6)) {
                checkmarkScale = 1.0
                checkmarkOpacity = 1.0
            }

            // Haptic feedback
            let generator = UINotificationFeedbackGenerator()
            generator.notificationOccurred(.success)

            // Auto-dismiss after 1.5 seconds
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                onDismiss()
            }
        }
    }
}

#if DEBUG
struct SuccessStateView_Previews: PreviewProvider {
    static var previews: some View {
        SuccessStateView(onDismiss: {})
            .background(BrandColors.warmCream)
    }
}
#endif

/**
 * ErrorStateView - Error display with action buttons
 */

import SwiftUI

struct ErrorStateView: View {
    let error: ShareCaptureError
    let onRetry: () -> Void
    let onManualEntry: () -> Void
    let onSaveForLater: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            // Error icon
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 56))
                .foregroundColor(BrandColors.adobeBrick)

            // Error message
            Text(error.message)
                .font(Typography.semibold(16))
                .foregroundColor(BrandColors.midnightNavy)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 20)

            // Action buttons
            VStack(spacing: 12) {
                if error.canRetry {
                    Button(action: onRetry) {
                        HStack {
                            Image(systemName: "arrow.clockwise")
                            Text("Try Again")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                }

                if error.canManualEntry {
                    Button(action: onManualEntry) {
                        HStack {
                            Image(systemName: "pencil")
                            Text("Enter Manually")
                        }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }

                if error.canSaveForLater {
                    Button(action: onSaveForLater) {
                        HStack {
                            Image(systemName: "clock")
                            Text("Save for Later")
                        }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }

                Button(action: onCancel) {
                    Text("Cancel")
                        .font(Typography.body(15))
                        .foregroundColor(BrandColors.stormGray)
                }
                .padding(.top, 8)
            }
            .padding(.horizontal, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
    }
}

#if DEBUG
struct ErrorStateView_Previews: PreviewProvider {
    static var previews: some View {
        ErrorStateView(
            error: .network(),
            onRetry: {},
            onManualEntry: {},
            onSaveForLater: {},
            onCancel: {}
        )
        .background(BrandColors.warmCream)
    }
}
#endif

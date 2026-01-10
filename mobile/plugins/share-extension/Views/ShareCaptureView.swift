/**
 * ShareCaptureView - Main container view for share extension
 *
 * Manages state transitions between loading, error, form, and success states.
 */

import SwiftUI

struct ShareCaptureView: View {
    @StateObject private var viewModel = ShareCaptureViewModel()
    @StateObject private var tripViewModel = TripSelectorViewModel()

    let url: String
    let caption: String?
    let onDismiss: () -> Void

    init(url: String, caption: String? = nil, onDismiss: @escaping () -> Void) {
        self.url = url
        self.caption = caption
        self.onDismiss = onDismiss
    }

    var body: some View {
        ZStack {
            // Background
            BrandColors.warmCream.ignoresSafeArea()

            // Content based on state
            switch viewModel.state {
            case .loading(let message):
                LoadingStateView(message: message)

            case .error(let error):
                ErrorStateView(
                    error: error,
                    onRetry: { viewModel.retry() },
                    onManualEntry: { viewModel.enterManualEntryMode() },
                    onSaveForLater: { viewModel.saveForLater() },
                    onCancel: onDismiss
                )

            case .form:
                CaptureFormView(
                    viewModel: viewModel,
                    tripViewModel: tripViewModel,
                    onSave: { viewModel.save() },
                    onCancel: onDismiss
                )

            case .saving:
                LoadingStateView(message: "Saving...")

            case .success:
                SuccessStateView(onDismiss: onDismiss)
            }
        }
        .onAppear {
            viewModel.processURL(url, caption: caption)
            tripViewModel.load()
        }
    }
}

// MARK: - Preview

#if DEBUG
struct ShareCaptureView_Previews: PreviewProvider {
    static var previews: some View {
        ShareCaptureView(
            url: "https://www.tiktok.com/@user/video/123",
            onDismiss: {}
        )
    }
}
#endif

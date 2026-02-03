/**
 * ShareCaptureView - Main container view for share extension
 *
 * Manages state transitions between loading, error, form, and success states.
 */

import Foundation
import SwiftUI

struct ShareCaptureView: View {
    @StateObject private var viewModel = ShareCaptureViewModel()
    @StateObject private var tripViewModel = TripSelectorViewModel()

    let url: String
    let caption: String?
    let videoFileURL: URL?
    let imageDataList: [Data]
    let onDismiss: () -> Void

    init(
        url: String,
        caption: String? = nil,
        videoFileURL: URL? = nil,
        imageDataList: [Data] = [],
        onDismiss: @escaping () -> Void
    ) {
        self.url = url
        self.caption = caption
        self.videoFileURL = videoFileURL
        self.imageDataList = imageDataList
        self.onDismiss = onDismiss
    }

    var body: some View {
        ZStack {
            // Background
            BrandColors.warmCream.ignoresSafeArea()

            // Content based on state - use explicit view identity to prevent flicker during re-renders
            Group {
                switch viewModel.state {
                case .loading(let message):
                    LoadingStateView(message: message, onCancel: onDismiss)

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
                    LoadingStateView(message: "Saving...", onCancel: nil)

                case .success:
                    SuccessStateView(onDismiss: onDismiss)

                case .successQueued(let reason):
                    SuccessQueuedView(reason: reason, onDismiss: onDismiss)
                }
            }
            .id(viewModel.state.caseIdentifier)
        }
        .onAppear {
            viewModel.processURL(
                url,
                caption: caption,
                videoFileURL: videoFileURL,
                imageDataList: imageDataList
            )
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

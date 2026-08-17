/**
 * LoadingStateView - Loading indicator for share extension
 *
 * Shows enhanced progress message with provider name and a 15-second
 * timeout warning with cancel option.
 */

import SwiftUI

/// Maximum time to wait for extraction before showing timeout warning
private let extractionTimeoutSeconds: Double = 15.0

/// Time to show initial message before showing progress indicator
private let initialDelaySeconds: Double = 2.0

struct LoadingStateView: View {
    let message: String
    var onCancel: (() -> Void)?

    // State for timeout and progress
    @State private var showTimeoutWarning = false
    @State private var showProgress = false
    @State private var progress: Double = 0

    // Timer for progress animation
    @State private var progressTimer: Timer?
    // Work item for cancellable delay
    @State private var delayWorkItem: DispatchWorkItem?

    var body: some View {
        VStack(spacing: 20) {
            ProgressView()
                .scaleEffect(1.2)
                .tint(BrandColors.midnightNavy)

            Text(showTimeoutWarning ? "Taking longer than expected..." : message)
                .font(Typography.semibold(16))
                .foregroundColor(BrandColors.midnightNavy)
                .multilineTextAlignment(.center)
                .animation(.easeInOut(duration: 0.3), value: showTimeoutWarning)

            // Progress bar
            if showProgress {
                VStack(spacing: 8) {
                    GeometryReader { geometry in
                        ZStack(alignment: .leading) {
                            // Track
                            RoundedRectangle(cornerRadius: 2)
                                .fill(BrandColors.midnightNavy.opacity(0.2))
                                .frame(height: 4)

                            // Fill
                            RoundedRectangle(cornerRadius: 2)
                                .fill(BrandColors.sunsetGold)
                                .frame(width: geometry.size.width * progress, height: 4)
                                .animation(.linear(duration: 0.1), value: progress)
                        }
                    }
                    .frame(height: 4)
                    .frame(maxWidth: 200)

                    Text("Extracting place details")
                        .font(Typography.body(13))
                        .foregroundColor(BrandColors.midnightNavy.opacity(0.6))
                }
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }

            // Timeout warning with cancel option
            if showTimeoutWarning, let onCancel = onCancel {
                VStack(spacing: 16) {
                    Text("The server is busy. You can wait or try again later.")
                        .font(Typography.body(14))
                        .foregroundColor(BrandColors.midnightNavy.opacity(0.6))
                        .multilineTextAlignment(.center)

                    Button(
                        action: {
                            // Clean up timer before canceling
                            cleanupTimers()
                            onCancel()
                        },
                        label: {
                            Text("Cancel")
                            .font(Typography.semibold(16))
                            .foregroundColor(BrandColors.midnightNavy)
                            .padding(.horizontal, 24)
                            .padding(.vertical, 12)
                            .background(BrandColors.midnightNavy.opacity(0.1))
                            .cornerRadius(8)
                        }
                    )
                }
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(40)
        .onAppear {
            startProgressAnimation()
        }
        .onDisappear {
            cleanupTimers()
        }
    }

    private func cleanupTimers() {
        progressTimer?.invalidate()
        progressTimer = nil
        delayWorkItem?.cancel()
        delayWorkItem = nil
    }

    private func startProgressAnimation() {
        // Show progress indicator after initial delay (cancellable)
        let workItem = DispatchWorkItem { [self] in
            withAnimation(.easeInOut(duration: 0.3)) {
                showProgress = true
            }
        }
        delayWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + initialDelaySeconds, execute: workItem)

        // Start progress timer (updates every 100ms for smooth animation)
        let startTime = Date()
        progressTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { timer in
            let elapsed = Date().timeIntervalSince(startTime)
            let newProgress = min(elapsed / extractionTimeoutSeconds, 1.0)

            // Timer is on main run loop, no need for DispatchQueue.main.async
            self.progress = newProgress

            // Show timeout warning after 15 seconds
            if elapsed >= extractionTimeoutSeconds && !showTimeoutWarning {
                withAnimation(.easeInOut(duration: 0.3)) {
                    showTimeoutWarning = true
                }
                timer.invalidate()
            }
        }
    }
}

#if DEBUG
struct LoadingStateView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            LoadingStateView(message: "Processing TikTok link...", onCancel: {})
                .background(BrandColors.warmCream)
                .previewDisplayName("Initial State")

            LoadingStateView(message: "Processing Instagram link...", onCancel: {})
                .background(BrandColors.warmCream)
                .previewDisplayName("With Cancel")
        }
    }
}
#endif

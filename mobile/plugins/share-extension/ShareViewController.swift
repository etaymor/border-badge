/**
 * ShareViewController - iOS Share Extension for Atlasi
 *
 * This extension receives shared URLs from TikTok, Instagram, and other apps,
 * and presents a full capture form to save places directly from the share sheet.
 *
 * Flow:
 * 1. User taps Share in TikTok/Instagram
 * 2. Selects "Atlasi" from share sheet
 * 3. Extension extracts URL from shared content
 * 4. If authenticated: Shows full capture form (SwiftUI)
 * 5. If not authenticated: Queues for later and shows message
 * 6. User completes form and saves directly to trip
 */

import UIKit
import SwiftUI
import UniformTypeIdentifiers
import UserNotifications

class ShareViewController: UIViewController {
    // MARK: - Constants

    /// App Group identifier for shared storage between extension and main app
    private let appGroupID = "group.com.atlasi.app"

    /// Key for storing shared URL in UserDefaults
    private let sharedURLKey = "SharedURL"

    /// Key for storing timestamp of when URL was shared
    private let timestampKey = "SharedURLTimestamp"

    /// Custom URL scheme for opening the main app
    private let customSchemeBase = "atlasi://share"

    /// The shared URL to process
    private var sharedURL: String?

    /// The caption text if available
    private var captionText: String?

    /// SwiftUI hosting controller
    private var hostingController: UIHostingController<ShareCaptureView>?

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 23/255, green: 42/255, blue: 58/255, alpha: 0.4)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        handleSharedContent()
    }

    // MARK: - Content Handling

    /// Main entry point for processing shared content
    private func handleSharedContent() {
        guard let extensionItem = extensionContext?.inputItems.first as? NSExtensionItem,
              let attachments = extensionItem.attachments else {
            showFallbackUI(error: "No content to share")
            return
        }

        // Process attachments - try URL first, then plain text
        processAttachments(attachments)
    }

    /// Process shared attachments looking for URLs
    private func processAttachments(_ attachments: [NSItemProvider]) {
        // Try to find a URL attachment first (most reliable)
        for attachment in attachments {
            if attachment.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                attachment.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] item, error in
                    DispatchQueue.main.async {
                        if let url = item as? URL {
                            self?.processURL(url.absoluteString)
                        } else {
                            self?.tryTextAttachments(attachments)
                        }
                    }
                }
                return
            }
        }

        // Fall back to text attachments (TikTok often shares text with URL embedded)
        tryTextAttachments(attachments)
    }

    /// Try to extract URL from text attachments
    private func tryTextAttachments(_ attachments: [NSItemProvider]) {
        for attachment in attachments {
            if attachment.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                attachment.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] item, error in
                    DispatchQueue.main.async {
                        if let text = item as? String {
                            // Store the full text as potential caption
                            self?.captionText = text

                            if let url = self?.extractURL(from: text) {
                                self?.processURL(url)
                            } else {
                                self?.showFallbackUI(error: "No URL found")
                            }
                        } else {
                            self?.showFallbackUI(error: "No URL found")
                        }
                    }
                }
                return
            }
        }

        // No usable content found
        showFallbackUI(error: "No URL found")
    }

    // MARK: - URL Extraction

    /// Extract the first URL from a text string
    private func extractURL(from text: String) -> String? {
        let urlPattern = "https?://[\\w\\-._~:/?#\\[\\]@!$&'()*+,;=%]+"

        guard let regex = try? NSRegularExpression(pattern: urlPattern, options: .caseInsensitive) else {
            return nil
        }

        let range = NSRange(text.startIndex..., in: text)
        if let match = regex.firstMatch(in: text, options: [], range: range),
           let matchRange = Range(match.range, in: text) {
            return String(text[matchRange])
        }

        return nil
    }

    // MARK: - URL Processing

    /// Process and show the capture form
    private func processURL(_ urlString: String) {
        sharedURL = urlString

        // Save to App Group as backup
        saveToAppGroup(urlString)

        // Check authentication status
        let authState = AuthService.checkAuthState()

        switch authState {
        case .authenticated:
            // Show full SwiftUI capture form
            showCaptureForm(url: urlString)

        case .unauthenticated, .expired:
            // Queue for later and show message
            OfflineQueueService.queueShare(
                url: urlString,
                caption: captionText,
                reason: .unauthenticated
            )
            showUnauthenticatedUI()
        }
    }

    /// Save URL to App Group for backup access
    @discardableResult
    private func saveToAppGroup(_ urlString: String) -> Bool {
        guard let userDefaults = UserDefaults(suiteName: appGroupID) else {
            NSLog("[Atlasi ShareExtension] Failed to access App Group: %@", appGroupID)
            return false
        }
        userDefaults.set(urlString, forKey: sharedURLKey)
        userDefaults.set(Date().timeIntervalSince1970, forKey: timestampKey)
        return true
    }

    // MARK: - SwiftUI Capture Form

    /// Show the full capture form
    private func showCaptureForm(url: String) {
        let captureView = ShareCaptureView(
            url: url,
            caption: captionText,
            onDismiss: { [weak self] in
                self?.completeRequest()
            }
        )

        let hostingController = UIHostingController(rootView: captureView)
        hostingController.view.backgroundColor = .clear

        addChild(hostingController)
        view.addSubview(hostingController.view)

        hostingController.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            hostingController.view.topAnchor.constraint(equalTo: view.topAnchor),
            hostingController.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            hostingController.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            hostingController.view.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])

        hostingController.didMove(toParent: self)
        self.hostingController = hostingController

        // Animate in
        hostingController.view.alpha = 0
        UIView.animate(withDuration: 0.25) {
            hostingController.view.alpha = 1
        }
    }

    // MARK: - Fallback UI (for errors and unauthenticated state)

    private let warmCream = UIColor(red: 253/255, green: 246/255, blue: 237/255, alpha: 1.0)
    private let midnightNavy = UIColor(red: 23/255, green: 42/255, blue: 58/255, alpha: 1.0)
    private let mossGreen = UIColor(red: 84/255, green: 122/255, blue: 95/255, alpha: 1.0)
    private let adobeBrick = UIColor(red: 193/255, green: 84/255, blue: 62/255, alpha: 1.0)

    /// Show UI for unauthenticated users
    private func showUnauthenticatedUI() {
        let containerView = createContainerView()
        view.addSubview(containerView)

        // Checkmark icon (saved for later)
        let iconView = UIImageView()
        let config = UIImage.SymbolConfiguration(pointSize: 48, weight: .medium)
        iconView.image = UIImage(systemName: "clock.badge.checkmark.fill", withConfiguration: config)
        iconView.tintColor = mossGreen
        iconView.translatesAutoresizingMaskIntoConstraints = false
        containerView.addSubview(iconView)

        // Title
        let titleLabel = UILabel()
        titleLabel.text = "Saved for Later"
        titleLabel.font = UIFont.systemFont(ofSize: 22, weight: .bold)
        titleLabel.textColor = midnightNavy
        titleLabel.textAlignment = .center
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        containerView.addSubview(titleLabel)

        // Subtitle
        let subtitleLabel = UILabel()
        subtitleLabel.text = "Sign in to Atlasi to add this place to a trip"
        subtitleLabel.font = UIFont.systemFont(ofSize: 14, weight: .regular)
        subtitleLabel.textColor = midnightNavy.withAlphaComponent(0.6)
        subtitleLabel.textAlignment = .center
        subtitleLabel.numberOfLines = 2
        subtitleLabel.translatesAutoresizingMaskIntoConstraints = false
        containerView.addSubview(subtitleLabel)

        // Open button
        let openButton = createPrimaryButton(title: "Open Atlasi")
        openButton.addTarget(self, action: #selector(openAtlasiTapped), for: .touchUpInside)
        containerView.addSubview(openButton)

        // Cancel button
        let cancelButton = createSecondaryButton(title: "Not now")
        cancelButton.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        containerView.addSubview(cancelButton)

        NSLayoutConstraint.activate([
            containerView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            containerView.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            containerView.widthAnchor.constraint(equalToConstant: 300),

            iconView.centerXAnchor.constraint(equalTo: containerView.centerXAnchor),
            iconView.topAnchor.constraint(equalTo: containerView.topAnchor, constant: 28),
            iconView.widthAnchor.constraint(equalToConstant: 56),
            iconView.heightAnchor.constraint(equalToConstant: 56),

            titleLabel.topAnchor.constraint(equalTo: iconView.bottomAnchor, constant: 16),
            titleLabel.leadingAnchor.constraint(equalTo: containerView.leadingAnchor, constant: 20),
            titleLabel.trailingAnchor.constraint(equalTo: containerView.trailingAnchor, constant: -20),

            subtitleLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 8),
            subtitleLabel.leadingAnchor.constraint(equalTo: containerView.leadingAnchor, constant: 20),
            subtitleLabel.trailingAnchor.constraint(equalTo: containerView.trailingAnchor, constant: -20),

            openButton.topAnchor.constraint(equalTo: subtitleLabel.bottomAnchor, constant: 24),
            openButton.leadingAnchor.constraint(equalTo: containerView.leadingAnchor, constant: 20),
            openButton.trailingAnchor.constraint(equalTo: containerView.trailingAnchor, constant: -20),
            openButton.heightAnchor.constraint(equalToConstant: 50),

            cancelButton.topAnchor.constraint(equalTo: openButton.bottomAnchor, constant: 12),
            cancelButton.centerXAnchor.constraint(equalTo: containerView.centerXAnchor),
            cancelButton.bottomAnchor.constraint(equalTo: containerView.bottomAnchor, constant: -20)
        ])

        animateContainerIn(containerView)
    }

    /// Show fallback UI for errors
    private func showFallbackUI(error: String) {
        let containerView = createContainerView()
        view.addSubview(containerView)

        // Error icon
        let iconView = UIImageView()
        let config = UIImage.SymbolConfiguration(pointSize: 48, weight: .medium)
        iconView.image = UIImage(systemName: "exclamationmark.circle.fill", withConfiguration: config)
        iconView.tintColor = adobeBrick
        iconView.translatesAutoresizingMaskIntoConstraints = false
        containerView.addSubview(iconView)

        // Error message
        let errorLabel = UILabel()
        errorLabel.text = error
        errorLabel.font = UIFont.systemFont(ofSize: 16, weight: .medium)
        errorLabel.textColor = midnightNavy
        errorLabel.textAlignment = .center
        errorLabel.numberOfLines = 2
        errorLabel.translatesAutoresizingMaskIntoConstraints = false
        containerView.addSubview(errorLabel)

        // Dismiss button
        let dismissButton = createSecondaryButton(title: "Dismiss")
        dismissButton.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        containerView.addSubview(dismissButton)

        NSLayoutConstraint.activate([
            containerView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            containerView.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            containerView.widthAnchor.constraint(equalToConstant: 280),

            iconView.centerXAnchor.constraint(equalTo: containerView.centerXAnchor),
            iconView.topAnchor.constraint(equalTo: containerView.topAnchor, constant: 28),
            iconView.widthAnchor.constraint(equalToConstant: 56),
            iconView.heightAnchor.constraint(equalToConstant: 56),

            errorLabel.topAnchor.constraint(equalTo: iconView.bottomAnchor, constant: 16),
            errorLabel.leadingAnchor.constraint(equalTo: containerView.leadingAnchor, constant: 20),
            errorLabel.trailingAnchor.constraint(equalTo: containerView.trailingAnchor, constant: -20),

            dismissButton.topAnchor.constraint(equalTo: errorLabel.bottomAnchor, constant: 20),
            dismissButton.centerXAnchor.constraint(equalTo: containerView.centerXAnchor),
            dismissButton.bottomAnchor.constraint(equalTo: containerView.bottomAnchor, constant: -20)
        ])

        animateContainerIn(containerView)
    }

    // MARK: - UI Helpers

    private func createContainerView() -> UIView {
        let containerView = UIView()
        containerView.backgroundColor = warmCream
        containerView.layer.cornerRadius = 20
        containerView.layer.shadowColor = midnightNavy.cgColor
        containerView.layer.shadowOpacity = 0.15
        containerView.layer.shadowOffset = CGSize(width: 0, height: 4)
        containerView.layer.shadowRadius = 16
        containerView.translatesAutoresizingMaskIntoConstraints = false
        return containerView
    }

    private func createPrimaryButton(title: String) -> UIButton {
        let button = UIButton(type: .system)
        button.setTitle(title, for: .normal)
        button.setTitleColor(.white, for: .normal)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 17, weight: .semibold)
        button.backgroundColor = mossGreen
        button.layer.cornerRadius = 12
        button.translatesAutoresizingMaskIntoConstraints = false
        return button
    }

    private func createSecondaryButton(title: String) -> UIButton {
        let button = UIButton(type: .system)
        button.setTitle(title, for: .normal)
        button.setTitleColor(midnightNavy.withAlphaComponent(0.5), for: .normal)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 15, weight: .regular)
        button.translatesAutoresizingMaskIntoConstraints = false
        return button
    }

    private func animateContainerIn(_ containerView: UIView) {
        containerView.alpha = 0
        containerView.transform = CGAffineTransform(scaleX: 0.9, y: 0.9)
        UIView.animate(withDuration: 0.25, delay: 0, usingSpringWithDamping: 0.8, initialSpringVelocity: 0) {
            containerView.alpha = 1
            containerView.transform = .identity
        }
    }

    // MARK: - Button Actions

    @objc private func openAtlasiTapped() {
        openMainApp()
    }

    @objc private func cancelTapped() {
        completeRequest()
    }

    /// Open the main app using custom URL scheme
    private func openMainApp() {
        guard let sharedURL = sharedURL,
              let encodedURL = sharedURL.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let customSchemeURL = URL(string: "\(customSchemeBase)?url=\(encodedURL)") else {
            completeRequest()
            return
        }

        extensionContext?.open(customSchemeURL) { [weak self] success in
            if !success {
                NSLog("[Atlasi ShareExtension] Failed to open URL: \(customSchemeURL)")
            }
            self?.completeRequest()
        }
    }

    // MARK: - Completion

    /// Complete the extension request and dismiss
    private func completeRequest() {
        // Animate out
        UIView.animate(withDuration: 0.2, animations: {
            self.view.subviews.forEach { $0.alpha = 0 }
            self.view.backgroundColor = UIColor.clear
        }) { _ in
            self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
        }
    }

    // MARK: - Notifications

    /// Schedule an optional notification to remind user to open the app
    /// Only sends if user has previously granted notification permissions
    private func scheduleOpenAppReminder() {
        let center = UNUserNotificationCenter.current()

        center.getNotificationSettings { settings in
            // Only send notification if user has granted permission
            guard settings.authorizationStatus == .authorized else { return }

            let content = UNMutableNotificationContent()
            content.title = "Place saved!"
            content.body = "Tap to add it to your trip in Atlasi"
            content.sound = .default

            // Show notification 2 seconds after extension closes
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 2, repeats: false)
            let request = UNNotificationRequest(
                identifier: "atlasi-share-extension-reminder",
                content: content,
                trigger: trigger
            )

            center.add(request) { error in
                if let error = error {
                    NSLog("[Atlasi ShareExtension] Notification error: %@", error.localizedDescription)
                }
            }
        }
    }
}

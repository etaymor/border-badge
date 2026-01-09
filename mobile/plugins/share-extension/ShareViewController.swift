/**
 * ShareViewController - iOS Share Extension for Atlasi
 *
 * This extension receives shared URLs from TikTok, Instagram, and other apps,
 * then opens the main Atlasi app with the URL for processing.
 *
 * Flow:
 * 1. User taps Share in TikTok/Instagram
 * 2. Selects "Atlasi" from share sheet
 * 3. Extension extracts URL from shared content
 * 4. Writes URL to App Group shared storage (backup)
 * 5. Opens main app via atlasi://share deep link using extensionContext.open()
 * 6. Completes extension request
 */

import UIKit
import UniformTypeIdentifiers

class ShareViewController: UIViewController {
    // MARK: - Constants

    /// App Group identifier for shared storage between extension and main app
    private let appGroupID = "group.com.atlasi.app"

    /// Key for storing shared URL in UserDefaults
    private let sharedURLKey = "SharedURL"

    /// Key for storing timestamp of when URL was shared
    private let timestampKey = "SharedURLTimestamp"

    /// Deep link URL base to open the main app (URL is appended as query parameter)
    private let appDeepLinkBase = "atlasi://share"

    // MARK: - UI Elements

    private lazy var containerView: UIView = {
        let view = UIView()
        view.backgroundColor = UIColor.systemBackground
        view.layer.cornerRadius = 16
        view.layer.shadowColor = UIColor.black.cgColor
        view.layer.shadowOpacity = 0.15
        view.layer.shadowOffset = CGSize(width: 0, height: 4)
        view.layer.shadowRadius = 12
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()

    private lazy var statusLabel: UILabel = {
        let label = UILabel()
        label.text = "Opening Atlasi..."
        label.font = UIFont.systemFont(ofSize: 17, weight: .semibold)
        label.textColor = UIColor.label
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private lazy var activityIndicator: UIActivityIndicatorView = {
        let indicator = UIActivityIndicatorView(style: .medium)
        indicator.translatesAutoresizingMaskIntoConstraints = false
        indicator.startAnimating()
        return indicator
    }()

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        handleSharedContent()
    }

    // MARK: - UI Setup

    private func setupUI() {
        // Semi-transparent background
        view.backgroundColor = UIColor.black.withAlphaComponent(0.4)

        // Add container card
        view.addSubview(containerView)
        containerView.addSubview(activityIndicator)
        containerView.addSubview(statusLabel)

        NSLayoutConstraint.activate([
            // Container centered in view
            containerView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            containerView.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            containerView.widthAnchor.constraint(equalToConstant: 220),
            containerView.heightAnchor.constraint(equalToConstant: 100),

            // Activity indicator
            activityIndicator.topAnchor.constraint(equalTo: containerView.topAnchor, constant: 20),
            activityIndicator.centerXAnchor.constraint(equalTo: containerView.centerXAnchor),

            // Status label
            statusLabel.topAnchor.constraint(equalTo: activityIndicator.bottomAnchor, constant: 12),
            statusLabel.leadingAnchor.constraint(equalTo: containerView.leadingAnchor, constant: 16),
            statusLabel.trailingAnchor.constraint(equalTo: containerView.trailingAnchor, constant: -16),
        ])

        // Animate in
        containerView.alpha = 0
        containerView.transform = CGAffineTransform(scaleX: 0.9, y: 0.9)
        UIView.animate(withDuration: 0.2) {
            self.containerView.alpha = 1
            self.containerView.transform = .identity
        }
    }

    // MARK: - Content Handling

    /// Main entry point for processing shared content
    private func handleSharedContent() {
        guard let extensionItem = extensionContext?.inputItems.first as? NSExtensionItem,
              let attachments = extensionItem.attachments else {
            showError("No content to share")
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
                        if let text = item as? String, let url = self?.extractURL(from: text) {
                            self?.processURL(url)
                        } else {
                            self?.showError("No URL found")
                        }
                    }
                }
                return
            }
        }

        // No usable content found
        showError("No URL found")
    }

    // MARK: - URL Extraction

    /// Extract the first URL from a text string
    /// Handles various URL formats from TikTok and Instagram
    private func extractURL(from text: String) -> String? {
        // Pattern matches http/https URLs with common URL characters
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

    /// Process and save the extracted URL, then open main app
    private func processURL(_ urlString: String) {
        // Save to App Group UserDefaults (as backup/fallback)
        saveToAppGroup(urlString)

        // Open main app via deep link
        openMainApp(with: urlString)
    }

    /// Save URL to App Group for backup access
    private func saveToAppGroup(_ urlString: String) {
        if let userDefaults = UserDefaults(suiteName: appGroupID) {
            userDefaults.set(urlString, forKey: sharedURLKey)
            userDefaults.set(Date().timeIntervalSince1970, forKey: timestampKey)
            userDefaults.synchronize()
        }
    }

    // MARK: - App Opening

    /// Open the main Atlasi app via deep link with the shared URL
    private func openMainApp(with sharedURL: String) {
        // URL-encode the shared URL and pass it as a query parameter
        guard let encodedURL = sharedURL.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: "\(appDeepLinkBase)?url=\(encodedURL)") else {
            showError("Invalid URL")
            return
        }

        // Use the official extensionContext API to open the URL (iOS 10+)
        // This is the correct way to open URLs from Share Extensions
        extensionContext?.open(url, completionHandler: { [weak self] success in
            DispatchQueue.main.async {
                if success {
                    self?.completeRequest()
                } else {
                    // App might not be installed or URL scheme not registered
                    self?.showError("Could not open Atlasi")
                }
            }
        })
    }

    // MARK: - Error Handling

    private func showError(_ message: String) {
        activityIndicator.stopAnimating()
        statusLabel.text = message
        statusLabel.textColor = UIColor.systemRed

        // Dismiss after showing error briefly
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            self?.completeRequest()
        }
    }

    // MARK: - Completion

    /// Complete the extension request and dismiss
    private func completeRequest() {
        // Animate out
        UIView.animate(withDuration: 0.2, animations: {
            self.containerView.alpha = 0
            self.containerView.transform = CGAffineTransform(scaleX: 0.9, y: 0.9)
            self.view.backgroundColor = UIColor.clear
        }) { _ in
            self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
        }
    }
}

/**
 * ShareViewController - iOS Share Extension for Atlasi
 *
 * This extension receives shared URLs from TikTok, Instagram, and other apps,
 * then opens the main Atlasi app with the URL for processing.
 *
 * Flow:
 * 1. User taps Share in TikTok/Instagram
 * 2. Selects "Save Place" (Atlasi)
 * 3. Extension extracts URL from shared content
 * 4. Writes URL to App Group shared storage
 * 5. Opens main app via atlasi://share deep link
 * 6. Completes extension request
 */

import UIKit
import UniformTypeIdentifiers

class ShareViewController: UIViewController {
    // MARK: - Constants

    /// App Group identifier for shared storage between extension and main app
    private let appGroupID = "group.com.borderbadge.app"

    /// Key for storing shared URL in UserDefaults
    private let sharedURLKey = "SharedURL"

    /// Key for storing timestamp of when URL was shared
    private let timestampKey = "SharedURLTimestamp"

    /// Deep link URL base to open the main app (URL is appended as query parameter)
    private let appDeepLinkBase = "atlasi://share"

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        // Set a minimal background - extension will close quickly
        view.backgroundColor = UIColor.systemBackground.withAlphaComponent(0.1)
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
            completeRequest()
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
                            self?.completeRequest()
                        }
                    }
                }
                return
            }
        }

        // No usable content found
        completeRequest()
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
        // Validate it's a supported URL (TikTok or Instagram)
        guard isSupportedURL(urlString) else {
            // Still save it - the main app will handle validation
            saveAndOpenApp(urlString)
            return
        }

        saveAndOpenApp(urlString)
    }

    /// Check if URL is from a supported platform
    private func isSupportedURL(_ url: String) -> Bool {
        let lowercased = url.lowercased()
        return lowercased.contains("tiktok.com") ||
               lowercased.contains("instagram.com") ||
               lowercased.contains("instagr.am")
    }

    /// Save URL to App Group and open main app
    private func saveAndOpenApp(_ urlString: String) {
        // Save to App Group UserDefaults (as backup/fallback)
        if let userDefaults = UserDefaults(suiteName: appGroupID) {
            userDefaults.set(urlString, forKey: sharedURLKey)
            userDefaults.set(Date().timeIntervalSince1970, forKey: timestampKey)
            userDefaults.synchronize()
        }

        // Open main app via deep link with URL as query parameter
        openMainApp(with: urlString)

        // Complete extension after brief delay to allow app launch
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            self?.completeRequest()
        }
    }

    // MARK: - App Opening

    /// Open the main Atlasi app via deep link with the shared URL
    private func openMainApp(with sharedURL: String) {
        // URL-encode the shared URL and pass it as a query parameter
        guard let encodedURL = sharedURL.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: "\(appDeepLinkBase)?url=\(encodedURL)") else { return }

        // Use responder chain to access UIApplication.shared.open
        // This is the approved way to open URLs from extensions
        var responder: UIResponder? = self

        while let currentResponder = responder {
            let selector = NSSelectorFromString("openURL:")
            if currentResponder.responds(to: selector) {
                currentResponder.perform(selector, with: url)
                return
            }
            responder = currentResponder.next
        }
    }

    // MARK: - Completion

    /// Complete the extension request and dismiss
    private func completeRequest() {
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }
}

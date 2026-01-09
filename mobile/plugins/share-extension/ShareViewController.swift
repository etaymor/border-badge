/**
 * ShareViewController - iOS Share Extension for Atlasi
 *
 * This extension receives shared URLs from TikTok, Instagram, and other apps,
 * saves them to App Group storage, and prompts the user to open the main app.
 *
 * Flow:
 * 1. User taps Share in TikTok/Instagram
 * 2. Selects "Atlasi" from share sheet
 * 3. Extension extracts URL from shared content
 * 4. Writes URL to App Group shared storage
 * 5. Shows branded confirmation with "Open Atlasi" button
 * 6. User taps button to dismiss, then opens main app manually
 * 7. Main app reads URL from App Group on foreground
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

    // MARK: - Brand Colors

    private let warmCream = UIColor(red: 253/255, green: 246/255, blue: 237/255, alpha: 1.0)
    private let midnightNavy = UIColor(red: 23/255, green: 42/255, blue: 58/255, alpha: 1.0)
    private let mossGreen = UIColor(red: 84/255, green: 122/255, blue: 95/255, alpha: 1.0)
    private let paperBeige = UIColor(red: 245/255, green: 236/255, blue: 224/255, alpha: 1.0)

    // MARK: - UI Elements

    private lazy var containerView: UIView = {
        let view = UIView()
        view.backgroundColor = warmCream
        view.layer.cornerRadius = 20
        view.layer.shadowColor = midnightNavy.cgColor
        view.layer.shadowOpacity = 0.15
        view.layer.shadowOffset = CGSize(width: 0, height: 4)
        view.layer.shadowRadius = 16
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()

    private lazy var activityIndicator: UIActivityIndicatorView = {
        let indicator = UIActivityIndicatorView(style: .medium)
        indicator.color = midnightNavy
        indicator.translatesAutoresizingMaskIntoConstraints = false
        indicator.startAnimating()
        return indicator
    }()

    private lazy var loadingLabel: UILabel = {
        let label = UILabel()
        label.text = "Saving place..."
        label.font = UIFont.systemFont(ofSize: 16, weight: .medium)
        label.textColor = midnightNavy
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private lazy var checkmarkIcon: UIImageView = {
        let config = UIImage.SymbolConfiguration(pointSize: 48, weight: .medium)
        let image = UIImage(systemName: "checkmark.circle.fill", withConfiguration: config)
        let imageView = UIImageView(image: image)
        imageView.tintColor = mossGreen
        imageView.contentMode = .scaleAspectFit
        imageView.translatesAutoresizingMaskIntoConstraints = false
        imageView.isHidden = true
        return imageView
    }()

    private lazy var titleLabel: UILabel = {
        let label = UILabel()
        label.text = "Place Saved!"
        label.font = UIFont.systemFont(ofSize: 22, weight: .bold)
        label.textColor = midnightNavy
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        label.isHidden = true
        return label
    }()

    private lazy var subtitleLabel: UILabel = {
        let label = UILabel()
        label.text = "Open Atlasi to add it to a trip"
        label.font = UIFont.systemFont(ofSize: 14, weight: .regular)
        label.textColor = midnightNavy.withAlphaComponent(0.6)
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        label.isHidden = true
        return label
    }()

    private lazy var openButton: UIButton = {
        let button = UIButton(type: .system)
        button.setTitle("Open Atlasi", for: .normal)
        button.setTitleColor(.white, for: .normal)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 17, weight: .semibold)
        button.backgroundColor = mossGreen
        button.layer.cornerRadius = 12
        button.translatesAutoresizingMaskIntoConstraints = false
        button.addTarget(self, action: #selector(openAtlasiTapped), for: .touchUpInside)
        button.isHidden = true
        return button
    }()

    private lazy var cancelButton: UIButton = {
        let button = UIButton(type: .system)
        button.setTitle("Not now", for: .normal)
        button.setTitleColor(midnightNavy.withAlphaComponent(0.5), for: .normal)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 15, weight: .regular)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        button.isHidden = true
        return button
    }()

    private lazy var errorIcon: UIImageView = {
        let config = UIImage.SymbolConfiguration(pointSize: 48, weight: .medium)
        let image = UIImage(systemName: "exclamationmark.circle.fill", withConfiguration: config)
        let imageView = UIImageView(image: image)
        imageView.tintColor = UIColor(red: 193/255, green: 84/255, blue: 62/255, alpha: 1.0) // adobeBrick
        imageView.contentMode = .scaleAspectFit
        imageView.translatesAutoresizingMaskIntoConstraints = false
        imageView.isHidden = true
        return imageView
    }()

    private lazy var errorLabel: UILabel = {
        let label = UILabel()
        label.font = UIFont.systemFont(ofSize: 16, weight: .medium)
        label.textColor = midnightNavy
        label.textAlignment = .center
        label.numberOfLines = 2
        label.translatesAutoresizingMaskIntoConstraints = false
        label.isHidden = true
        return label
    }()

    private lazy var dismissButton: UIButton = {
        let button = UIButton(type: .system)
        button.setTitle("Dismiss", for: .normal)
        button.setTitleColor(midnightNavy.withAlphaComponent(0.5), for: .normal)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 15, weight: .regular)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        button.isHidden = true
        return button
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
        // Semi-transparent overlay with brand tint
        view.backgroundColor = midnightNavy.withAlphaComponent(0.4)

        // Add container card
        view.addSubview(containerView)

        // Add loading elements
        containerView.addSubview(activityIndicator)
        containerView.addSubview(loadingLabel)

        // Add success elements
        containerView.addSubview(checkmarkIcon)
        containerView.addSubview(titleLabel)
        containerView.addSubview(subtitleLabel)
        containerView.addSubview(openButton)
        containerView.addSubview(cancelButton)

        // Add error elements
        containerView.addSubview(errorIcon)
        containerView.addSubview(errorLabel)
        containerView.addSubview(dismissButton)

        NSLayoutConstraint.activate([
            // Container centered in view
            containerView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            containerView.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            containerView.widthAnchor.constraint(equalToConstant: 280),

            // Loading state
            activityIndicator.centerXAnchor.constraint(equalTo: containerView.centerXAnchor),
            activityIndicator.topAnchor.constraint(equalTo: containerView.topAnchor, constant: 32),

            loadingLabel.topAnchor.constraint(equalTo: activityIndicator.bottomAnchor, constant: 16),
            loadingLabel.leadingAnchor.constraint(equalTo: containerView.leadingAnchor, constant: 20),
            loadingLabel.trailingAnchor.constraint(equalTo: containerView.trailingAnchor, constant: -20),
            loadingLabel.bottomAnchor.constraint(equalTo: containerView.bottomAnchor, constant: -32),

            // Success state
            checkmarkIcon.centerXAnchor.constraint(equalTo: containerView.centerXAnchor),
            checkmarkIcon.topAnchor.constraint(equalTo: containerView.topAnchor, constant: 28),
            checkmarkIcon.widthAnchor.constraint(equalToConstant: 56),
            checkmarkIcon.heightAnchor.constraint(equalToConstant: 56),

            titleLabel.topAnchor.constraint(equalTo: checkmarkIcon.bottomAnchor, constant: 16),
            titleLabel.leadingAnchor.constraint(equalTo: containerView.leadingAnchor, constant: 20),
            titleLabel.trailingAnchor.constraint(equalTo: containerView.trailingAnchor, constant: -20),

            subtitleLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 6),
            subtitleLabel.leadingAnchor.constraint(equalTo: containerView.leadingAnchor, constant: 20),
            subtitleLabel.trailingAnchor.constraint(equalTo: containerView.trailingAnchor, constant: -20),

            openButton.topAnchor.constraint(equalTo: subtitleLabel.bottomAnchor, constant: 24),
            openButton.leadingAnchor.constraint(equalTo: containerView.leadingAnchor, constant: 20),
            openButton.trailingAnchor.constraint(equalTo: containerView.trailingAnchor, constant: -20),
            openButton.heightAnchor.constraint(equalToConstant: 50),

            cancelButton.topAnchor.constraint(equalTo: openButton.bottomAnchor, constant: 12),
            cancelButton.centerXAnchor.constraint(equalTo: containerView.centerXAnchor),
            cancelButton.bottomAnchor.constraint(equalTo: containerView.bottomAnchor, constant: -20),

            // Error state
            errorIcon.centerXAnchor.constraint(equalTo: containerView.centerXAnchor),
            errorIcon.topAnchor.constraint(equalTo: containerView.topAnchor, constant: 28),
            errorIcon.widthAnchor.constraint(equalToConstant: 56),
            errorIcon.heightAnchor.constraint(equalToConstant: 56),

            errorLabel.topAnchor.constraint(equalTo: errorIcon.bottomAnchor, constant: 16),
            errorLabel.leadingAnchor.constraint(equalTo: containerView.leadingAnchor, constant: 20),
            errorLabel.trailingAnchor.constraint(equalTo: containerView.trailingAnchor, constant: -20),

            dismissButton.topAnchor.constraint(equalTo: errorLabel.bottomAnchor, constant: 20),
            dismissButton.centerXAnchor.constraint(equalTo: containerView.centerXAnchor),
            dismissButton.bottomAnchor.constraint(equalTo: containerView.bottomAnchor, constant: -20),
        ])

        // Animate in
        containerView.alpha = 0
        containerView.transform = CGAffineTransform(scaleX: 0.9, y: 0.9)
        UIView.animate(withDuration: 0.25, delay: 0, usingSpringWithDamping: 0.8, initialSpringVelocity: 0) {
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

    /// Process and save the extracted URL
    private func processURL(_ urlString: String) {
        // Save to App Group UserDefaults
        // The main app will read this on next foreground
        saveToAppGroup(urlString)

        // Show success UI
        showSuccess()
    }

    /// Save URL to App Group for backup access
    private func saveToAppGroup(_ urlString: String) {
        if let userDefaults = UserDefaults(suiteName: appGroupID) {
            userDefaults.set(urlString, forKey: sharedURLKey)
            userDefaults.set(Date().timeIntervalSince1970, forKey: timestampKey)
            userDefaults.synchronize()
        }
    }

    // MARK: - Success UI

    /// Show success state with buttons
    private func showSuccess() {
        // Hide loading elements
        activityIndicator.stopAnimating()
        activityIndicator.isHidden = true
        loadingLabel.isHidden = true

        // Show success elements with animation
        UIView.animate(withDuration: 0.3) {
            self.checkmarkIcon.isHidden = false
            self.titleLabel.isHidden = false
            self.subtitleLabel.isHidden = false
            self.openButton.isHidden = false
            self.cancelButton.isHidden = false

            self.checkmarkIcon.alpha = 1
            self.titleLabel.alpha = 1
            self.subtitleLabel.alpha = 1
            self.openButton.alpha = 1
            self.cancelButton.alpha = 1
        }
    }

    // MARK: - Error Handling

    private func showError(_ message: String) {
        // Hide loading elements
        activityIndicator.stopAnimating()
        activityIndicator.isHidden = true
        loadingLabel.isHidden = true

        // Show error elements
        errorLabel.text = message
        UIView.animate(withDuration: 0.3) {
            self.errorIcon.isHidden = false
            self.errorLabel.isHidden = false
            self.dismissButton.isHidden = false

            self.errorIcon.alpha = 1
            self.errorLabel.alpha = 1
            self.dismissButton.alpha = 1
        }
    }

    // MARK: - Button Actions

    @objc private func openAtlasiTapped() {
        // Dismiss the extension - user will open the main app manually
        // The URL is already saved to App Group storage
        completeRequest()
    }

    @objc private func cancelTapped() {
        // Just dismiss without any action
        completeRequest()
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

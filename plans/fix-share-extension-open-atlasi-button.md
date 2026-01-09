# Fix: Share Extension "Open Atlasi" Button Not Working

## Summary

The "Open Atlasi" button in the iOS Share Extension closes the modal but does not open the main app. This is a **fundamental iOS limitation** - Apple does not support `extensionContext?.open()` for Share Extensions, only for Today Widgets.

**Root Cause**: The implementation uses `extensionContext?.open(atlasi://share?url=...)` which Apple explicitly does not support for Share Extensions. The completion handler returns `false`, but the UI doesn't communicate this failure to users.

## Problem Analysis

### Current Implementation Flow (Broken)

```
User taps "Open Atlasi" button
    ↓
ShareViewController.openAtlasiTapped()
    ↓
extensionContext?.open(URL("atlasi://share?url=..."))
    ↓
iOS blocks the request (Share Extensions cannot open URLs)
    ↓
completion handler returns success: false
    ↓
completeRequest() dismisses extension
    ↓
User sees modal close, app never opens ❌
```

### Apple's Official Position

From [Apple Developer Forums Thread 773342](https://developer.apple.com/forums/thread/773342):
> "A Today widget (and no other app extension type) can ask the system to open its containing app by calling the openURL:completionHandler: method of the NSExtensionContext class."

This means **Share Extensions fundamentally cannot open the containing app via URL schemes**.

### Working Fallback (Already Implemented)

The app already has a working fallback:
1. URL is saved to App Group UserDefaults
2. When user manually opens Atlasi, `checkAppGroupForSharedURL()` reads the URL
3. App navigates to ShareCaptureScreen

**The problem is UX**: Users expect the button to open the app, but it doesn't.

## Solution

### Approach: Accept iOS Limitation & Improve UX

Since Apple doesn't support opening the app from Share Extensions, we should:

1. **Remove the misleading "Open Atlasi" button**
2. **Update the success UI to clearly communicate next steps**
3. **Add optional Local Notification to prompt user** (if permissions granted)

This is the same approach used by popular apps like Instagram ("Saved to Collection") and Pinterest ("Pin saved") - they don't try to open the main app from share extensions.

## Implementation Plan

### Phase 1: Fix the Share Extension UI

#### 1.1 Update ShareViewController.swift Success State

**File**: [ShareViewController.swift](mobile/plugins/share-extension/ShareViewController.swift)

Remove the "Open Atlasi" button and update messaging:

```swift
// REMOVE these UI elements:
// - openButton (lines 110-121)
// - openAtlasiTapped() (lines 423-426)
// - openMainApp() (lines 428-448)

// UPDATE success UI to show:
// - Checkmark icon ✓
// - "Place Saved!" title ✓
// - NEW subtitle: "Open Atlasi to add it to your trip"
// - Single "Done" button (replaces "Not now")
```

**Before:**
```
┌─────────────────────────┐
│         ✓               │
│    Place Saved!         │
│ Open Atlasi to add it   │
│      to a trip          │
│                         │
│   [  Open Atlasi  ]     │  ← Broken, misleading
│       Not now           │
└─────────────────────────┘
```

**After:**
```
┌─────────────────────────┐
│         ✓               │
│    Place Saved!         │
│                         │
│  Open Atlasi from your  │
│  home screen to add     │
│  this to a trip         │
│                         │
│      [  Done  ]         │  ← Clear, honest
└─────────────────────────┘
```

#### 1.2 Simplify Button Actions

**File**: [ShareViewController.swift](mobile/plugins/share-extension/ShareViewController.swift)

```swift
// Keep only cancelButton, rename to "doneButton"
private lazy var doneButton: UIButton = {
    let button = UIButton(type: .system)
    button.setTitle("Done", for: .normal)
    button.setTitleColor(.white, for: .normal)
    button.titleLabel?.font = UIFont.systemFont(ofSize: 17, weight: .semibold)
    button.backgroundColor = mossGreen
    button.layer.cornerRadius = 12
    button.translatesAutoresizingMaskIntoConstraints = false
    button.addTarget(self, action: #selector(doneTapped), for: .touchUpInside)
    button.isHidden = true
    return button
}()

@objc private func doneTapped() {
    completeRequest()
}
```

#### 1.3 Update Subtitle Text

**File**: [ShareViewController.swift](mobile/plugins/share-extension/ShareViewController.swift:99-107)

```swift
private lazy var subtitleLabel: UILabel = {
    let label = UILabel()
    label.text = "Open Atlasi from your home screen\nto add this to a trip"
    label.font = UIFont.systemFont(ofSize: 14, weight: .regular)
    label.textColor = midnightNavy.withAlphaComponent(0.6)
    label.textAlignment = .center
    label.numberOfLines = 2
    label.translatesAutoresizingMaskIntoConstraints = false
    label.isHidden = true
    return label
}()
```

### Phase 2: Add Local Notification Prompt (Optional Enhancement)

Add an optional notification that appears after the extension closes, prompting the user to open the app.

#### 2.1 Request Notification Permission

**File**: [ShareViewController.swift](mobile/plugins/share-extension/ShareViewController.swift)

```swift
import UserNotifications

// In showSuccess(), after showing UI:
private func scheduleOpenAppReminder() {
    let center = UNUserNotificationCenter.current()

    center.getNotificationSettings { settings in
        guard settings.authorizationStatus == .authorized else { return }

        let content = UNMutableNotificationContent()
        content.title = "Place saved!"
        content.body = "Tap to add it to your trip in Atlasi"
        content.sound = .default

        // Show notification 2 seconds after extension closes
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 2, repeats: false)
        let request = UNNotificationRequest(
            identifier: "share-extension-reminder",
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
```

#### 2.2 Handle Notification Tap in Main App

**File**: [App.tsx](mobile/App.tsx)

The notification tap will open the app, which will then read from App Group via `checkAppGroupForSharedURL()`. No additional code needed - the existing flow handles this.

### Phase 3: Clean Up Dead Code

#### 3.1 Remove Unused Code from ShareViewController.swift

Remove:
- `openButton` property and constraints
- `cancelButton` (rename existing to `doneButton`)
- `openAtlasiTapped()` method
- `openMainApp()` method

#### 3.2 Update Layout Constraints

Adjust constraints in `setupUI()` to work with single button:

```swift
// Success state constraints - single Done button
doneButton.topAnchor.constraint(equalTo: subtitleLabel.bottomAnchor, constant: 24),
doneButton.leadingAnchor.constraint(equalTo: containerView.leadingAnchor, constant: 20),
doneButton.trailingAnchor.constraint(equalTo: containerView.trailingAnchor, constant: -20),
doneButton.heightAnchor.constraint(equalToConstant: 50),
doneButton.bottomAnchor.constraint(equalTo: containerView.bottomAnchor, constant: -24),
```

### Phase 4: Configuration Cleanup

#### 4.1 Move LSApplicationQueriesSchemes (Optional)

The `LSApplicationQueriesSchemes` in the extension's Info.plist isn't doing anything useful since we're removing the URL opening code. It can be removed or moved to the main app's Info.plist for future use.

**File**: [Info.plist](mobile/plugins/share-extension/Info.plist:5-8)

```xml
<!-- REMOVE this section - not needed without URL opening -->
<key>LSApplicationQueriesSchemes</key>
<array>
    <string>atlasi</string>
</array>
```

## Acceptance Criteria

### Functional Requirements

- [ ] "Open Atlasi" button is removed from Share Extension UI
- [ ] Success state shows clear messaging about opening app manually
- [ ] Single "Done" button dismisses the extension cleanly
- [ ] URL is still saved to App Group for later retrieval
- [ ] Main app correctly reads URL when opened manually
- [ ] (Optional) Local notification prompts user to open app

### Non-Functional Requirements

- [ ] Extension loads and dismisses within 300ms
- [ ] No console errors or warnings from removed code
- [ ] Extension works offline (App Group storage is local)

### Quality Gates

- [ ] Tested on iOS 15, 16, 17, and 18 simulators
- [ ] Tested on physical device
- [ ] Tested sharing from TikTok, Instagram, Safari
- [ ] Build succeeds with `npx expo prebuild && xcodebuild`

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| [ShareViewController.swift](mobile/plugins/share-extension/ShareViewController.swift) | Modify | Remove "Open Atlasi" button, update UI messaging |
| [Info.plist](mobile/plugins/share-extension/Info.plist) | Modify | Remove unused LSApplicationQueriesSchemes |

## Alternative Approaches Considered

### 1. Universal Links Instead of Custom URL Scheme

**Rejected**: Universal Links also don't work from Share Extensions. Apple's restriction applies to all URL opening, not just custom schemes.

### 2. NSUserActivity Handoff

**Rejected**: Handoff requires both devices to be on the same network and is designed for cross-device continuity, not extension-to-app communication.

### 3. Clipboard-Based Communication

**Rejected**: Would require reading clipboard which triggers a privacy prompt. Also unreliable and could conflict with user's actual clipboard contents.

### 4. Background App Refresh Trigger

**Rejected**: Cannot reliably trigger immediate app launch. Background refresh is scheduled by iOS with no timing guarantees.

### 5. Keep Button But Show Error on Failure

**Rejected**: Poor UX to show an error every time. Better to not offer the broken functionality at all.

## References

### Internal References
- [ShareViewController.swift](mobile/plugins/share-extension/ShareViewController.swift) - Current implementation
- [App.tsx:193-222](mobile/App.tsx#L193-L222) - App Group polling on foreground
- [shareExtensionBridge.ts](mobile/src/services/shareExtensionBridge.ts) - Deep link parsing
- [ios-share-extension.md](docs/ios-share-extension.md) - Share extension documentation

### External References
- [Apple: NSExtensionContext.open() Documentation](https://developer.apple.com/documentation/foundation/nsextensioncontext/1414827-open)
- [Apple Forums: Share Extensions Cannot Open URLs](https://developer.apple.com/forums/thread/773342)
- [Apple Forums: Launching Main App from Share Extension](https://developer.apple.com/forums/thread/104579)
- [iOS 18 openURL Changes](https://developer.apple.com/forums/thread/764570)

## Testing Plan

### Manual Testing

1. **Share from TikTok**
   - Open TikTok video → Share → Save Place
   - Verify "Place Saved!" message appears
   - Verify subtitle says "Open Atlasi from your home screen..."
   - Tap "Done" → Extension closes
   - Open Atlasi manually → Verify ShareCaptureScreen appears with URL

2. **Share from Instagram**
   - Same flow as TikTok

3. **Share from Safari**
   - Same flow as TikTok

4. **Notification Flow (if implemented)**
   - Share from any app
   - Verify notification appears after ~2 seconds
   - Tap notification → App opens to ShareCaptureScreen

### Edge Cases

- Share while app is in background → App Group read on foreground
- Share while not authenticated → URL saved to pending, processed after login
- Share multiple URLs rapidly → Each should be processed (with deduplication)
- Share then force-quit app → URL persists in App Group for next launch

## Estimated Effort

- **Phase 1 (UI Fix)**: Small - Remove button, update text
- **Phase 2 (Notifications)**: Medium - Optional enhancement
- **Phase 3 (Cleanup)**: Small - Delete dead code
- **Phase 4 (Config)**: Small - Remove unused plist entry

**Total**: 1-2 hours for core fix, additional hour if adding notifications

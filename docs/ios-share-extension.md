# iOS Share Extension

This document describes the iOS Share Extension implementation that allows users to save travel spots from TikTok, Instagram, and other apps directly to Atlasi.

## Overview

The Share Extension enables users to:

1. Share a TikTok or Instagram URL from any app
2. Select "Atlasi" from the iOS share sheet
3. See a branded capture UI within the extension
4. View detected places (supports multi-place extraction for "Top 10" style posts)
5. Select which places to save and choose a destination trip
6. Complete saving the places directly in the extension or open the main app

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           User Flow                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. User in TikTok/Instagram                                           │
│       │                                                                 │
│       ▼                                                                 │
│  2. Tap Share → Select "Atlasi"                                        │
│       │                                                                 │
│       ▼                                                                 │
│  3. ShareViewController.swift (Extension)                              │
│     - Shows branded loading UI ("Saving place...")                     │
│     - Extracts URL from shared content                                 │
│     - Writes URL to App Group UserDefaults                             │
│     - Shows success UI with "Open Atlasi" button                       │
│       │                                                                 │
│       ▼                                                                 │
│  4. User taps "Open Atlasi" (or "Not now")                             │
│     - Extension opens Universal Link: https://atlasi.app/share?url=... │
│     - iOS intercepts and opens main app (Associated Domains)           │
│       │                                                                 │
│       ▼                                                                 │
│  5. Atlasi main app receives URL                                       │
│     - App.tsx checks App Group on foreground                           │
│     - Reads URL via SharedGroupPreferences native module               │
│     - Navigates to ShareCaptureScreen                                  │
│       │                                                                 │
│       ▼                                                                 │
│  6. ShareCaptureScreen                                                 │
│     - Calls /ingest/social API to fetch metadata                       │
│     - Shows thumbnail, detected place for confirmation                 │
│     - User selects trip and saves                                      │
│     - Clears App Group storage on completion                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## File Structure

```
mobile/
├── plugins/
│   ├── withShareExtension.js              # Expo config plugin
│   └── share-extension/
│       ├── ShareViewController.swift       # Native Swift extension UI and logic
│       ├── SharedGroupPreferences.swift    # Native module for App Group access
│       ├── SharedGroupPreferences.m        # Obj-C bridge for React Native
│       ├── Info.plist                      # Extension configuration
│       └── ShareExtension.entitlements     # App Group entitlements
├── src/
│   └── services/
│       └── shareExtensionBridge.ts         # React Native bridge service
└── app.config.js                           # Registers plugin and extension config
backend/
├── app/
│   ├── static/
│   │   └── .well-known/
│   │       └── apple-app-site-association  # AASA file for Universal Links
│   └── templates/
│       └── share_fallback.html             # Fallback page for non-app users
```

## How It Works

### 1. Expo Config Plugin (`withShareExtension.js`)

Since this is a **managed Expo project** (no `ios/` folder in the repository), we use an Expo Config Plugin to inject the native Share Extension at build time.

The plugin:

- Adds App Group entitlement (`group.com.atlasi.app`) to the main app
- Creates the Share Extension target in the Xcode project
- Copies Swift source files to the extension directory
- Configures build settings and entitlements

### 2. ShareViewController.swift

The native Swift extension controller provides a branded in-extension UI with trip selection:

**Capture UI:**
- Shows the shared URL thumbnail and detected place information
- Displays multiple detected places for "Top 10" style posts (multi-place extraction)
- Multi-select checkboxes for choosing which places to save
- Trip selector dropdown to choose a destination trip
- "Save for Later" option saves to the Saved Places holding area (uncategorized trip)
- Location search for manual place selection if auto-detection fails
- Category selector for entry type (place, food, stay, experience)

**Multi-Place Selection:**
- When multiple places are detected, users see a scrollable list with checkboxes
- All places are selected by default
- Users can deselect places they don't want to save
- "Save X Places" button shows the count of selected places
- Uses the batch `/ingest/save-places` endpoint for efficient saving

**Trip Selection:**
- Fetches user's trips via the API
- Suggested trips are returned by the backend (matching country first, then "Saved Places")
- Includes "Save for Later" option that uses the uncategorized system trip
- The uncategorized trip is lazily created via `GET /trips/uncategorized` when first selected

**Video Frame Sampling:**
- For video posts, the mobile app can sample frames on-device
- Frames are encoded as base64 JPEG/PNG and sent via the `video_frames` request parameter
- This bypasses server-side video download, reducing latency and bandwidth
- Up to 20 frames can be sent, each ~1.5MB max
- The backend uses multimodal LLM to extract place names from the frames

**Success State:**
- Shows checkmark icon with "Place Saved!" or "X Places Saved!" message
- "Open Atlasi" button opens the main app via Universal Link
- "Not now" button dismisses without opening the app

**Error State:**
- Shows error icon with descriptive message
- Platform-specific errors (e.g., "This TikTok video is private") are shown via `extraction_error`
- "Dismiss" button closes the extension

The extension uses the app's brand colors (warm cream, midnight navy, moss green) for a consistent visual experience.

### 3. SharedGroupPreferences Native Module

A custom React Native native module that allows the main app to read/write App Group UserDefaults:

**Swift Implementation (`SharedGroupPreferences.swift`):**
- `getItem(key)` - Read a string value from App Group
- `setItem(key, value)` - Write a string value to App Group
- `getTimestamp(key)` - Read a timestamp value
- `clearAll()` - Clear all shared data

**Obj-C Bridge (`SharedGroupPreferences.m`):**
- Exports the Swift module to React Native

**React Native Service (`shareExtensionBridge.ts`):**
- `getSharedURLFromAppGroup()` - Read the shared URL
- `clearSharedURLFromAppGroup()` - Clear after processing
- `completeAppGroupShare(url)` - Mark processed and clear storage

### 4. App Group Communication

The extension and main app share data via App Group UserDefaults:

- **App Group ID:** `group.com.atlasi.app`
- **Keys:**
  - `SharedURL`: The URL that was shared
  - `SharedURLTimestamp`: When the URL was shared (Unix timestamp)

### 5. Universal Links

The extension opens the main app via Universal Links instead of custom URL schemes:

**Why Universal Links?**
- iOS Share Extensions cannot open custom URL schemes (`atlasi://`)
- Universal Links (`https://atlasi.app/share`) work from extensions via `extensionContext.open()`
- Provides a fallback web page for users without the app installed

**Backend Configuration:**
- AASA file at `/.well-known/apple-app-site-association` maps `/share` paths to the app
- Fallback page at `/share` shows "Get Atlasi" for non-app users

**App Configuration:**
- Associated Domains entitlement: `applinks:atlasi.app`
- App handles both Universal Links and custom scheme deep links

### 6. Deep Link Handling (`App.tsx`)

The main app:

- Checks App Group storage on foreground (handles "Not now" case)
- Listens for Universal Links (`https://atlasi.app/share?url=...`)
- Listens for custom scheme deep links (`atlasi://share?url=...`)
- Reads the URL from App Group via native module
- Navigates to `ShareCaptureScreen` with the URL
- Handles unauthenticated users (queues share for later)
- Clears App Group storage after successful save

## Building the Share Extension

### Prerequisites

- Xcode 14.0 or later
- EAS CLI (`npm install -g eas-cli`)
- Apple Developer account with appropriate provisioning profiles

### Development Build

The Share Extension requires a native build - it will **not work** in Expo Go.

1. **Create a development build:**

   ```bash
   cd mobile
   eas build --platform ios --profile development
   ```

2. **Install on device:**

   After the build completes, scan the QR code or download the IPA to install on your device.

### Production Build

```bash
cd mobile
eas build --platform ios --profile production
```

### Preflight build checks (fast failure before EAS)

Run these locally (or in CI) after dependencies are installed to catch Swift/share-extension issues before a full EAS upload.

**Share extension-only compile (no code signing, Simulator):**
```bash
cd mobile/ios
xcodebuild \
  -workspace Atlasi.xcworkspace \
  -scheme ShareExtension \
  -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  CODE_SIGNING_ALLOWED=NO \
  SKIP_INSTALL=NO \
  build
```
- Fastest check; fails on Swift or asset errors in the extension without needing provisioning.

**Full Debug archive (mirrors EAS path):**
```bash
cd mobile/ios
xcodebuild \
  -workspace Atlasi.xcworkspace \
  -scheme Atlasi \
  -configuration Debug \
  -destination 'generic/platform=iOS' \
  -archivePath /tmp/Atlasi-Debug.xcarchive \
  archive
```
- Matches the EAS Debug archive flow to surface signing or packaging issues earlier.

### Local Development (Optional)

If you need to debug the native code:

1. **Generate native project:**

   ```bash
   cd mobile
   npx expo prebuild --platform ios
   ```

2. **Open in Xcode:**

   ```bash
   open ios/Atlasi.xcworkspace
   ```

3. **Build and run** from Xcode to test the Share Extension

> **Note:** The generated `ios/` folder is gitignored. Run `prebuild` again after changing plugin configuration.

## Configuration

### Bundle Identifiers

| Target          | Bundle ID                            |
| --------------- | ------------------------------------ |
| Main App        | `com.atlasi.app`                |
| Share Extension | `com.atlasi.app.ShareExtension` |

### App Group

The App Group `group.com.atlasi.app` must be configured in:

- Apple Developer Portal (Identifiers → App Groups)
- Both app and extension provisioning profiles

### Activation Rules

The extension appears for:

- Web URLs (max 1)
- Plain text (for TikTok which shares caption + URL as text)

Configured in `Info.plist`:

```xml
<key>NSExtensionActivationRule</key>
<dict>
    <key>NSExtensionActivationSupportsText</key>
    <true/>
    <key>NSExtensionActivationSupportsWebURLWithMaxCount</key>
    <integer>1</integer>
</dict>
```

## Testing

### Manual Testing

1. Build and install the app on a physical device (Share Extensions don't work in Simulator)
2. Open TikTok or Instagram
3. Find a travel video/post
4. Tap Share → "Save Place" (BorderBadge icon)
5. The main app should open with ShareCaptureScreen

### Unit Tests

The `shareExtensionBridge.ts` service has comprehensive unit tests:

```bash
cd mobile
npm test -- src/__tests__/services/shareExtensionBridge.test.ts
```

Tests cover:

- Deep link detection (`isShareExtensionDeepLink`) for both custom scheme and Universal Links
- Parameter parsing (`parseDeepLinkParams`)
- Pending share storage (`savePendingShare`, `getPendingShare`, `clearPendingShare`)
- Duplicate prevention (`markShareProcessed`, `wasRecentlyProcessed`)
- Processing status tracking (`isCurrentlyProcessing`, `markAsProcessing`, `clearProcessingStatus`)
- App Group completion (`completeAppGroupShare`)

## Troubleshooting

### Share Extension doesn't appear in share sheet

1. **Rebuild the app** - Extensions are bundled at build time
2. **Check bundle IDs** - Extension must use `com.atlasi.app.ShareExtension`
3. **Check entitlements** - App Group must match in both app and extension

### Share Extension appears but app doesn't open automatically

**This is expected behavior.** iOS does not allow Share Extensions to open the containing app programmatically. Only Today Widgets have this capability.

The extension saves the URL to App Group storage, and the main app reads it when opened manually. A notification may also appear (if permissions are granted) to remind the user to open the app.

### URL not passed to main app

1. **App Group misconfiguration** - Verify both app and extension have the same App Group ID
2. **Check UserDefaults** - Extension writes to `group.com.atlasi.app`
3. **Native module not available** - The full App Group reading requires `react-native-shared-group-preferences` or a custom native module

### Extension works in development but not production

1. **Provisioning profiles** - Both app and extension need valid production profiles
2. **App Group capability** - Must be enabled in App Store Connect
3. **Code signing** - Extension must be signed with the same team as main app

## Future Improvements

### Activation Rule Tightening

The current activation rule shows the extension for all text and URLs. To limit to TikTok/Instagram only:

```xml
<key>NSExtensionActivationRule</key>
<string>
SUBQUERY (
  extensionItems,
  $extensionItem,
  SUBQUERY (
    $extensionItem.attachments,
    $attachment,
    ANY $attachment.registeredTypeIdentifiers UTI-CONFORMS-TO "public.url"
  ).@count > 0
  AND (
    $extensionItem.attributedTitle CONTAINS "tiktok" OR
    $extensionItem.attributedTitle CONTAINS "instagram"
  )
).@count > 0
</string>
```

## Related Files

- [App.tsx](../mobile/App.tsx) - Deep link handling
- [ShareCaptureScreen.tsx](../mobile/src/screens/share/ShareCaptureScreen.tsx) - UI for confirming shared places
- [useSocialIngest.ts](../mobile/src/hooks/useSocialIngest.ts) - API hooks for social ingest
- [Backend ingest API](../backend/app/api/ingest.py) - Server-side URL processing

## References

- [Expo Config Plugins Documentation](https://docs.expo.dev/config-plugins/introduction/)
- [Apple Share Extension Guide](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html)
- [App Groups Documentation](https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_security_application-groups)

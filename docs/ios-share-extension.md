# iOS Share Extension

This document describes the iOS Share Extension implementation that allows users to save travel spots from TikTok, Instagram, and other apps directly to Atlasi.

## Overview

The Share Extension enables users to:

1. Share a TikTok or Instagram URL from any app
2. Select "Atlasi" from the iOS share sheet
3. See a branded confirmation UI within the extension
4. Open the main app to complete saving the place to a trip

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

The native Swift extension controller provides a branded in-extension UI:

**Loading State:**
- Shows activity indicator with "Saving place..." message
- Extracts URL from attachments (supports both URL type and plain text with embedded URLs)
- Writes URL to App Group UserDefaults

**Success State:**
- Shows checkmark icon with "Place Saved!" message
- "Open Atlasi" button opens the main app via Universal Link
- "Not now" button dismisses without opening the app

**Error State:**
- Shows error icon with descriptive message
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

### Share Extension appears but app doesn't open

1. **Check deep link scheme** - Must be `atlasi://`
2. **Verify in `app.config.js`:**
   ```javascript
   scheme: 'atlasi',
   ```

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

# iOS Share Extension

This document describes the iOS Share Extension implementation that allows users to save travel spots from TikTok, Instagram, and other apps directly to BorderBadge.

## Overview

The Share Extension enables users to:

1. Share a TikTok or Instagram URL from any app
2. Select "Save Place" (BorderBadge) from the iOS share sheet
3. Have the main app open with the ShareCaptureScreen to confirm the place

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           User Flow                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. User in TikTok/Instagram                                           │
│       │                                                                 │
│       ▼                                                                 │
│  2. Tap Share → Select "Save Place"                                    │
│       │                                                                 │
│       ▼                                                                 │
│  3. ShareViewController.swift (Extension)                              │
│     - Extracts URL from shared content                                 │
│     - Writes URL to App Group UserDefaults                             │
│     - Opens borderbadge://share deep link                              │
│       │                                                                 │
│       ▼                                                                 │
│  4. BorderBadge main app receives deep link                            │
│     - App.tsx handles borderbadge://share                              │
│     - Reads URL from App Group (if native module available)            │
│     - Navigates to ShareCaptureScreen                                  │
│       │                                                                 │
│       ▼                                                                 │
│  5. ShareCaptureScreen                                                 │
│     - Calls /ingest/social API to fetch metadata                       │
│     - Shows thumbnail, detected place for confirmation                 │
│     - User selects trip and saves                                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## File Structure

```
mobile/
├── plugins/
│   ├── withShareExtension.js         # Expo config plugin
│   └── share-extension/
│       ├── ShareViewController.swift  # Native Swift extension code
│       ├── Info.plist                 # Extension configuration
│       └── ShareExtension.entitlements # App Group entitlements
├── src/
│   └── services/
│       └── shareExtensionBridge.ts    # React Native bridge
└── app.config.js                      # Registers plugin
```

## How It Works

### 1. Expo Config Plugin (`withShareExtension.js`)

Since this is a **managed Expo project** (no `ios/` folder in the repository), we use an Expo Config Plugin to inject the native Share Extension at build time.

The plugin:

- Adds App Group entitlement (`group.com.borderbadge.app`) to the main app
- Creates the Share Extension target in the Xcode project
- Copies Swift source files to the extension directory
- Configures build settings and entitlements

### 2. ShareViewController.swift

The native Swift extension controller that:

- Receives shared content from iOS
- Extracts URLs from attachments (supports both URL type and plain text with embedded URLs)
- Writes the URL to App Group shared storage
- Opens the main app via `borderbadge://share` deep link

### 3. App Group Communication

The extension and main app share data via App Group UserDefaults:

- **App Group ID:** `group.com.borderbadge.app`
- **Keys:**
  - `SharedURL`: The URL that was shared
  - `SharedURLTimestamp`: When the URL was shared

### 4. Deep Link Handling (`App.tsx`)

The main app:

- Listens for `borderbadge://share` deep links
- Reads the URL from App Group storage (when native module is available)
- Navigates to `ShareCaptureScreen` with the URL
- Handles the case where user isn't authenticated (queues share for later)

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
   open ios/borderbadge.xcworkspace
   ```

3. **Build and run** from Xcode to test the Share Extension

> **Note:** The generated `ios/` folder is gitignored. Run `prebuild` again after changing plugin configuration.

## Configuration

### Bundle Identifiers

| Target          | Bundle ID                            |
| --------------- | ------------------------------------ |
| Main App        | `com.borderbadge.app`                |
| Share Extension | `com.borderbadge.app.ShareExtension` |

### App Group

The App Group `group.com.borderbadge.app` must be configured in:

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

- Deep link detection (`isShareExtensionDeepLink`)
- Parameter parsing (`parseDeepLinkParams`)
- Pending share storage (`savePendingShare`, `getPendingShare`, `clearPendingShare`)
- Duplicate prevention (`markShareProcessed`, `wasRecentlyProcessed`)

## Troubleshooting

### Share Extension doesn't appear in share sheet

1. **Rebuild the app** - Extensions are bundled at build time
2. **Check bundle IDs** - Extension must use `com.borderbadge.app.ShareExtension`
3. **Check entitlements** - App Group must match in both app and extension

### Share Extension appears but app doesn't open

1. **Check deep link scheme** - Must be `borderbadge://`
2. **Verify in `app.config.js`:**
   ```javascript
   scheme: 'borderbadge',
   ```

### URL not passed to main app

1. **App Group misconfiguration** - Verify both app and extension have the same App Group ID
2. **Check UserDefaults** - Extension writes to `group.com.borderbadge.app`
3. **Native module not available** - The full App Group reading requires `react-native-shared-group-preferences` or a custom native module

### Extension works in development but not production

1. **Provisioning profiles** - Both app and extension need valid production profiles
2. **App Group capability** - Must be enabled in App Store Connect
3. **Code signing** - Extension must be signed with the same team as main app

## Future Improvements

### Native Module for App Group Reading

Currently, the full App Group reading requires a native module. Options:

1. Install `react-native-shared-group-preferences`
2. Create a custom native module

Until then, the extension opens the app via deep link, and the URL is passed through App Group (readable once native module is added).

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

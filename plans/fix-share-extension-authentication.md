# Fix: iOS Share Extension Authentication Not Working

**Type:** 🐛 Bug Fix (Critical)
**Priority:** P0 - Blocks Key Feature
**Created:** 2025-01-11

## Overview

The iOS Share Extension always shows the "Saved for Later / Sign in to Atlasi" unauthenticated screen instead of the full share capture form, even when the user is freshly signed in via Apple Sign-In or email/password. This breaks a core feature of the app.

## Problem Statement

When users share a URL from TikTok/Instagram to Atlasi:
1. The Share Extension opens (`ShareViewController.swift`)
2. It calls `KeychainHelper.hasToken` to check authentication (line 160)
3. `hasToken` returns `false` (incorrectly)
4. User sees "Saved for Later" instead of the capture form
5. This happens 100% of the time regardless of auth method or fresh sign-in

**User Impact:** Complete failure of the share-to-save flow, which is the app's primary value proposition.

## Root Cause Analysis

After comprehensive research, **the root cause is the missing `keychain-access-groups` entitlement in the EAS build configuration for the Share Extension**.

### Evidence

#### 1. app.config.js is Missing Keychain Access Groups for Extension

**File:** [app.config.js](mobile/app.config.js#L64-L72)

```javascript
appExtensions: [
  {
    targetName: 'ShareExtension',
    bundleIdentifier: 'com.atlasi.app.ShareExtension',
    entitlements: {
      'com.apple.security.application-groups': ['group.com.atlasi.app'],
      // ⚠️ MISSING: 'keychain-access-groups': ['$(AppIdentifierPrefix)com.atlasi.app']
    },
  },
],
```

The EAS build configuration declares `application-groups` but **NOT** `keychain-access-groups` for the Share Extension. This means:
- During EAS builds, the Share Extension's provisioning profile may not include keychain sharing capability
- Even though [ShareExtension.entitlements](mobile/ios/ShareExtension/ShareExtension.entitlements) has the correct entitlement, EAS may not apply it

#### 2. The Local Entitlements Files ARE Correct

Both entitlements files have the correct keychain access group:

**Main App** ([Atlasi.entitlements](mobile/ios/Atlasi/Atlasi.entitlements#L17-L20)):
```xml
<key>keychain-access-groups</key>
<array>
  <string>$(AppIdentifierPrefix)com.atlasi.app</string>
</array>
```

**Share Extension** ([ShareExtension.entitlements](mobile/ios/ShareExtension/ShareExtension.entitlements#L9-L12)):
```xml
<key>keychain-access-groups</key>
<array>
  <string>$(AppIdentifierPrefix)com.atlasi.app</string>
</array>
```

#### 3. Code Implementation is Correct

Both the TypeScript and Swift sides use matching parameters:

**Main App Token Storage** ([api.ts:172-176](mobile/src/services/api.ts#L172-L176)):
```typescript
const KEYCHAIN_ACCESS_GROUP = '2AB5M8J3G6.com.atlasi.app';

export async function storeTokens(accessToken: string, refreshToken: string): Promise<void> {
  const options = getSecureStoreOptions(); // Returns { accessGroup: KEYCHAIN_ACCESS_GROUP } on iOS
  await SecureStore.setItemAsync(TOKEN_KEY, accessToken, options);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken, options);
}
```

**Share Extension Token Reading** ([KeychainHelper.swift:16-35](mobile/plugins/share-extension/Utilities/KeychainHelper.swift#L16-L35)):
```swift
private static let service = "app:no-auth"
private static let tokenKey = "auth_token"
private static let accessGroup: String? = "2AB5M8J3G6.com.atlasi.app"
```

**expo-secure-store** ([SecureStoreModule.swift:172-189](mobile/node_modules/expo-secure-store/ios/SecureStoreModule.swift#L172-L189)):
- Correctly uses `kSecAttrAccessGroup` when `accessGroup` option is provided
- Service name format: `app:no-auth` (matches KeychainHelper)

#### 4. The Expo Plugin Sets Entitlements Locally But EAS May Override

The [withShareExtension.js](mobile/plugins/withShareExtension.js) plugin correctly configures:
- App Groups entitlement
- Keychain access groups entitlement
- Copies the ShareExtension.entitlements file

However, EAS builds use the `appExtensions` configuration in `app.config.js` to generate provisioning profiles. If `keychain-access-groups` isn't declared there, the provisioning profile won't include that capability.

## Hypothesis Ranking

| # | Hypothesis | Confidence | Evidence |
|---|------------|------------|----------|
| 1 | **EAS build doesn't apply keychain entitlement to extension** | 95% | `app.config.js` is missing keychain-access-groups in appExtensions |
| 2 | Provisioning profile mismatch | 70% | Would need to inspect built IPA |
| 3 | expo-secure-store not writing with accessGroup | 30% | Source code shows it should work |
| 4 | Token migration not running | 10% | Only affects legacy users |

## Proposed Solution

### Phase 1: Fix EAS Build Configuration (PRIMARY FIX)

Add `keychain-access-groups` to the EAS extension configuration in `app.config.js`:

**File:** `mobile/app.config.js`

```javascript
extra: {
  eas: {
    projectId: '4b406924-7c4e-4723-87a1-c40ad227d873',
    build: {
      experimental: {
        ios: {
          appExtensions: [
            {
              targetName: 'ShareExtension',
              bundleIdentifier: 'com.atlasi.app.ShareExtension',
              entitlements: {
                'com.apple.security.application-groups': ['group.com.atlasi.app'],
                // ADD THIS LINE:
                'keychain-access-groups': ['$(AppIdentifierPrefix)com.atlasi.app'],
              },
            },
          ],
        },
      },
    },
  },
},
```

### Phase 2: Add Diagnostic Logging (FOR VERIFICATION)

Add logging to both sides to confirm the fix works:

**KeychainHelper.swift** - Add detailed logging:

```swift
static func getToken() -> String? {
    let result = read(key: tokenKey)
    NSLog("[Atlasi KeychainHelper] getToken: %@", result != nil ? "FOUND" : "NOT FOUND")
    return result
}

private static func read(key: String) -> String? {
    // ... existing code ...
    let status = SecItemCopyMatching(query as CFDictionary, &result)

    // Enhanced logging for debugging
    if status != errSecSuccess {
        NSLog("[Atlasi KeychainHelper] Keychain read failed: status=%d, key=%@, group=%@",
              status, key, accessGroup ?? "nil")
    }
    // ... rest of existing code ...
}
```

**api.ts** - Add logging to storeTokens:

```typescript
export async function storeTokens(accessToken: string, refreshToken: string): Promise<void> {
  console.log('[API] Storing tokens with accessGroup:', KEYCHAIN_ACCESS_GROUP);
  cachedToken = accessToken;
  const options = getSecureStoreOptions();
  await SecureStore.setItemAsync(TOKEN_KEY, accessToken, options);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken, options);
  console.log('[API] Tokens stored successfully');
}
```

### Phase 3: Verification Steps

1. **Update app.config.js** with keychain-access-groups
2. **Run prebuild clean**: `cd mobile && npx expo prebuild --clean`
3. **Create development build**: `eas build --platform ios --profile development`
4. **Install on device**
5. **Sign in fresh** (sign out first if already signed in)
6. **Test share extension** from Safari/TikTok
7. **Check logs** for KeychainHelper output

### Phase 4: Verify Built IPA Entitlements (IF STILL FAILING)

```bash
# Download the IPA from EAS
eas build:download --platform ios --profile development

# Extract and check entitlements
unzip *.ipa
codesign -d --entitlements - Payload/Atlasi.app
codesign -d --entitlements - Payload/Atlasi.app/PlugIns/ShareExtension.appex

# Look for:
# <key>keychain-access-groups</key>
# <array>
#   <string>2AB5M8J3G6.com.atlasi.app</string>
# </array>
```

## Acceptance Criteria

### Functional Requirements
- [ ] Share Extension shows full capture form when user is authenticated
- [ ] Share Extension shows "Saved for Later" only when user is truly not signed in
- [ ] Works with all auth methods: Apple Sign-In, Google Sign-In, Email/Password
- [ ] Works immediately after fresh sign-in (no app restart required)
- [ ] Works after app has been backgrounded/force-quit

### Technical Verification
- [ ] EAS build IPA contains correct keychain-access-groups in both main app and extension
- [ ] KeychainHelper logs show "FOUND" when token exists
- [ ] No keychain errors (status codes) in logs

## Files to Modify

| File | Change |
|------|--------|
| [mobile/app.config.js](mobile/app.config.js) | Add keychain-access-groups to appExtensions |
| [mobile/plugins/share-extension/Utilities/KeychainHelper.swift](mobile/plugins/share-extension/Utilities/KeychainHelper.swift) | Add diagnostic logging (optional) |
| [mobile/src/services/api.ts](mobile/src/services/api.ts) | Add diagnostic logging (optional) |

## Risk Analysis

### Low Risk
- The fix is a configuration change, not code logic change
- The entitlement already exists in the local files, we're just ensuring EAS applies it
- No impact on Android or web

### Potential Issues
- May need to regenerate provisioning profiles in Apple Developer Portal
- EAS build cache may need to be cleared (`eas build --clear-cache`)

## Testing Plan

### Pre-Build Verification
```bash
cd mobile
npx expo prebuild --clean
# Verify ios/ShareExtension/ShareExtension.entitlements has keychain-access-groups
cat ios/ShareExtension/ShareExtension.entitlements | grep -A3 "keychain-access-groups"
```

### Development Build Test Matrix

| Scenario | Auth Method | Expected Result |
|----------|-------------|-----------------|
| Fresh install → Sign in → Share | Apple | Shows capture form |
| Fresh install → Sign in → Share | Email/Password | Shows capture form |
| Existing user → Sign out → Sign in → Share | Any | Shows capture form |
| Existing user → Force quit app → Share | N/A | Shows capture form |
| Not signed in → Share | N/A | Shows "Saved for Later" |

### Production Verification
After successful development testing:
1. Submit production build via `eas build --platform ios --profile production`
2. Test via TestFlight before App Store release

## References

### Project Files
- [mobile/app.config.js](mobile/app.config.js) - EAS build configuration
- [mobile/plugins/withShareExtension.js](mobile/plugins/withShareExtension.js) - Expo config plugin
- [mobile/plugins/share-extension/ShareViewController.swift](mobile/plugins/share-extension/ShareViewController.swift) - Extension entry point
- [mobile/plugins/share-extension/Utilities/KeychainHelper.swift](mobile/plugins/share-extension/Utilities/KeychainHelper.swift) - Token reading
- [mobile/src/services/api.ts](mobile/src/services/api.ts) - Token storage
- [docs/ios-share-extension.md](docs/ios-share-extension.md) - Share extension documentation

### External Documentation
- [Expo App Extensions](https://docs.expo.dev/build-reference/app-extensions/)
- [Apple: Sharing Keychain Items](https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps)
- [expo-secure-store accessGroup](https://docs.expo.dev/versions/latest/sdk/securestore/)

### Related Research
- expo-secure-store supports `accessGroup` option: [SecureStoreModule.swift:187-189](mobile/node_modules/expo-secure-store/ios/SecureStoreModule.swift#L187-L189)
- Service name format verified: `app:no-auth` matches between writer and reader

---

## Summary

**The fix is simple:** Add one line to `app.config.js` to declare `keychain-access-groups` in the EAS extension configuration. This ensures the provisioning profile includes the keychain sharing capability, allowing the Share Extension to read tokens stored by the main app.

**Estimated effort:** 5 minutes to implement, 30 minutes to build and verify.

# Fix iOS Clipboard "Paste from Other Apps" Permission Popup

**Created:** 2025-12-27
**Status:** Draft
**Type:** Enhancement / UX Improvement

---

## Overview

The app currently shows the iOS "Allow Paste" permission popup every time it attempts to read clipboard content when foregrounding. This creates a frustrating user experience, especially when the clipboard contains irrelevant content. This plan documents how to eliminate or significantly reduce these permission popups.

---

## Problem Statement

Starting with iOS 16, Apple introduced a modal permission dialog that appears whenever an app attempts to read clipboard content programmatically. In Border Badge:

1. The `useClipboardListener` hook checks clipboard when the app foregrounds
2. `Clipboard.getStringAsync()` triggers the iOS permission popup
3. This popup appears **every time** the app foregrounds on iOS 16.0
4. Users who copy random URLs get annoying permission prompts
5. Even when users tap "Allow", the popup returns on the next foreground

**Current Implementation Flow:**
```
App Foreground → hasStringAsync() [no popup] → getStringAsync() [POPUP!] → Process URL
```

---

## Root Cause Analysis

| API Method | Triggers Popup? | Reason |
|------------|-----------------|--------|
| `hasStringAsync()` | NO | Metadata check only |
| `hasUrlAsync()` | NO | Metadata check only |
| `getStringAsync()` | **YES** | Reads actual content |
| `getUrlAsync()` | **YES** | Reads actual content |
| `ClipboardPasteButton` | NO | User-initiated action |

iOS considers any programmatic **reading of actual clipboard content** a privacy-sensitive operation requiring explicit user consent. The only exception is user-initiated paste actions (long-press menu, Cmd+V, or `UIPasteControl`).

---

## Solution Options

### Option A: Guide Users to iOS Settings (Immediate / No Code Required)

**iOS 16.1+ introduced per-app clipboard settings:**
1. Go to **Settings** → **Border Badge** → **Paste from Other Apps**
2. Select **"Allow"** (instead of "Ask")
3. Popup never appears again for this app

**Pros:**
- Zero code changes required
- Permanent solution once configured
- User retains full control

**Cons:**
- Requires user action outside the app
- Not discoverable without guidance
- Only works on iOS 16.1+ (16.0 has no settings option)
- Users may forget about this option

**Implementation:**
- Add an in-app educational modal/tooltip
- Consider deep-linking to Settings (limited support)
- Add help text in the clipboard detection settings toggle

---

### Option B: Use ClipboardPasteButton (Recommended - Best UX)

Replace automatic clipboard reading with a native `ClipboardPasteButton` that bypasses the permission system entirely.

**How it works:**
```tsx
import { ClipboardPasteButton, isPasteButtonAvailable } from 'expo-clipboard';

<ClipboardPasteButton
  onPress={(data) => {
    if (data.type === 'text') {
      const detected = detectSocialUrl(data.text);
      if (detected) handleDetectedUrl(detected);
    }
  }}
  displayMode="iconAndLabel"
  acceptedContentTypes={['plain-text', 'url']}
/>
```

**Pros:**
- No permission popup ever
- Apple-sanctioned approach
- User is in control of when to paste
- Works on iOS 16+ regardless of system settings

**Cons:**
- Changes from "automatic detection" to "manual action"
- Button has limited styling options (iOS system control)
- Only available on iOS 16+ (need fallback for older iOS)
- Less "magical" than automatic detection

---

### Option C: Hybrid Approach (Best of Both Worlds)

Combine automatic detection for willing users with manual paste button as fallback:

1. **First foreground:** Try `getStringAsync()` - popup appears
2. **If user allows:** Continue with automatic detection (popup won't appear again if they set iOS setting to "Allow")
3. **If user denies or popup is annoying:** Show `ClipboardPasteButton` in UI
4. **Provide guidance:** Direct users to iOS Settings for permanent fix

**Implementation:**
- Keep current `useClipboardListener` for users who enable iOS permission
- Add `ClipboardPasteButton` as persistent/contextual UI element
- Track permission state (allowed vs denied) to adjust UX
- Show educational content about iOS Settings option

---

## Recommended Implementation: Option C (Hybrid)

### Phase 1: Add ClipboardPasteButton to UI

**File: `mobile/src/components/share/ClipboardPasteButton.tsx`**

```tsx
import { useCallback } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { ClipboardPasteButton as ExpoClipboardPasteButton, isPasteButtonAvailable } from 'expo-clipboard';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { detectSocialUrl, DetectedClipboardUrl } from '@hooks/useClipboardListener';

interface Props {
  onDetect: (detected: DetectedClipboardUrl) => void;
  showLabel?: boolean;
}

export function ClipboardPasteButton({ onDetect, showLabel = true }: Props) {
  if (!isPasteButtonAvailable) {
    // iOS < 16 - button not available, rely on automatic detection
    return null;
  }

  const handlePaste = useCallback((data: { type: string; text?: string }) => {
    if (data.type === 'text' && data.text) {
      const detected = detectSocialUrl(data.text);
      if (detected) {
        onDetect(detected);
      }
    }
  }, [onDetect]);

  return (
    <View style={styles.container}>
      <ExpoClipboardPasteButton
        onPress={handlePaste}
        displayMode={showLabel ? 'iconAndLabel' : 'iconOnly'}
        acceptedContentTypes={['plain-text', 'url']}
        style={styles.button}
      />
      {showLabel && (
        <Text style={styles.hint}>Tap to paste TikTok/Instagram link</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 8,
  },
  button: {
    height: 44,
    width: 120,
  },
  hint: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.stormGray,
  },
});
```

### Phase 2: Add Settings Guidance

**File: `mobile/src/screens/profile/components/ClipboardSettingsModal.tsx`**

Create a modal that explains iOS clipboard permissions and guides users to Settings:

```tsx
// Show when user taps "Learn more" or when permission error occurs
// Content:
// - Explain why popup appears
// - Steps to set "Allow" in iOS Settings
// - Option to use manual paste button instead
```

### Phase 3: Update Settings Toggle UI

**File: `mobile/src/screens/profile/components/ProfileInfoSection.tsx`**

Add subtitle/helper text to the clipboard detection toggle:

```tsx
<View>
  <Text>Automatic Clipboard Detection</Text>
  <Text style={styles.helperText}>
    iOS may ask permission each time. Tap "Learn more" to allow permanently.
  </Text>
  <Switch value={clipboardDetectionEnabled} onValueChange={...} />
  <TouchableOpacity onPress={openClipboardSettingsModal}>
    <Text style={styles.learnMore}>Learn more</Text>
  </TouchableOpacity>
</View>
```

### Phase 4: Add Permission Error Handling with Guidance

Update `ClipboardBannerProvider` to show guidance when permission denied:

```tsx
// When hasPermissionError is true, show:
// - "Clipboard access denied"
// - "Use paste button or enable in iOS Settings"
// - [Open Settings] [Use Paste Button] buttons
```

---

## Acceptance Criteria

### Functional Requirements
- [ ] `ClipboardPasteButton` component created and working on iOS 16+
- [ ] Paste button available in appropriate UI location
- [ ] Automatic detection continues to work for users who allow permission
- [ ] Educational modal/content explains iOS Settings option
- [ ] Settings toggle has helper text about permissions
- [ ] Graceful fallback for iOS < 16 (automatic detection, no paste button)

### Non-Functional Requirements
- [ ] No regression in existing clipboard detection functionality
- [ ] Paste button follows iOS Human Interface Guidelines
- [ ] Accessibility labels for VoiceOver users

### Quality Gates
- [ ] Manual testing on iOS 16.0, 16.1+, and iOS 15
- [ ] Test permission allow/deny scenarios
- [ ] Test paste button with valid and invalid clipboard content

---

## iOS Settings Deep Link (Optional Enhancement)

iOS allows limited deep linking to Settings:

```tsx
import { Linking, Platform } from 'react-native';

function openAppSettings() {
  if (Platform.OS === 'ios') {
    // Opens the app's Settings page (not specifically clipboard settings)
    Linking.openURL('app-settings:');
  }
}
```

**Note:** This opens the app's main Settings page. Users must navigate to "Paste from Other Apps" manually. There's no direct deep link to clipboard permissions.

---

## Technical Notes

### iOS Version Compatibility Matrix

| iOS Version | Popup Behavior | System Settings | ClipboardPasteButton |
|-------------|----------------|-----------------|---------------------|
| iOS 14-15 | No popup | N/A | Not available |
| iOS 16.0 | Popup every time | **Not available** | Available |
| iOS 16.1+ | Popup (until configured) | Available | Available |
| iOS 17+ | Same as 16.1+ | Available | Available |

### Known expo-clipboard Issues

1. **Issue #40189:** When user denies permission, `getStringAsync()` returns empty string instead of throwing error. Cannot distinguish "denied" from "empty clipboard".

2. **Issue #30617:** `ClipboardPasteButton` may appear grayed out on first app launch. Still functional when tapped.

### What Cannot Be Done

- **Cannot query permission state:** No API to check if clipboard permission is "Allow", "Deny", or "Ask"
- **Cannot set permission programmatically:** Only user can change via iOS Settings
- **Cannot customize popup:** iOS system UI, not configurable
- **Cannot bypass popup:** Only user actions (paste button, long-press menu) avoid it

---

## Implementation Tasks

### MVP (Reduce Friction)

1. **Add educational content in settings** (~30 min)
   - Helper text under clipboard toggle
   - "Learn more" button that opens modal
   - Modal explains iOS Settings option with steps

2. **Improve permission error handling** (~30 min)
   - Show actionable guidance when permission denied
   - Add "Open Settings" button
   - Session-scoped dismissal (existing)

### Enhanced (Eliminate Popup)

3. **Create ClipboardPasteButton component** (~1 hr)
   - Wrapper around expo-clipboard's native component
   - Integration with detectSocialUrl
   - Proper fallback for iOS < 16

4. **Add paste button to UI** (~1 hr)
   - Decide placement (floating button, header action, or in-screen element)
   - Integrate with existing ClipboardBanner flow
   - Test with various clipboard content

5. **Update settings UI** (~30 min)
   - Rename toggle if needed
   - Add option to choose automatic vs manual paste mode

---

## User Documentation

### In-App Help Text

**For Settings Modal:**
> **Why do I see "Allow Paste" popups?**
>
> iOS requires apps to ask permission before reading your clipboard. This protects your privacy from apps silently reading sensitive information.
>
> **To stop seeing this popup:**
> 1. Open iPhone **Settings**
> 2. Scroll down and tap **Border Badge**
> 3. Tap **Paste from Other Apps**
> 4. Select **Allow**
>
> Alternatively, use the **Paste** button in the app to manually paste links without any popup.

---

## References

### Internal References
- Current implementation: `mobile/src/hooks/useClipboardListener.ts`
- Banner component: `mobile/src/components/share/ClipboardBanner.tsx`
- Settings store: `mobile/src/stores/settingsStore.ts`
- Settings UI: `mobile/src/screens/profile/components/ProfileInfoSection.tsx`

### External References
- [Expo Clipboard Documentation](https://docs.expo.dev/versions/latest/sdk/clipboard/)
- [Apple UIPasteControl Documentation](https://developer.apple.com/documentation/uikit/uipastecontrol)
- [iOS 16 Pasteboard Privacy Changes](https://sarunw.com/posts/uipasteboard-privacy-change-ios16/)
- [WWDC 2022: What's New in Privacy](https://developer.apple.com/videos/play/wwdc2022/10096/) (clipboard changes at 9:24)
- [expo-clipboard Issue #40189](https://github.com/expo/expo/issues/40189)

---

## Summary

The iOS "Allow Paste" popup is an **intentional privacy feature** by Apple that cannot be bypassed programmatically. The best solutions are:

1. **Immediate:** Add in-app guidance to help users set "Allow" in iOS Settings (iOS 16.1+)
2. **Better UX:** Add `ClipboardPasteButton` as an alternative that never shows popups
3. **Long-term:** Consider making manual paste the default, with automatic as opt-in

The hybrid approach gives users choice while reducing friction for the majority who find the popup annoying.

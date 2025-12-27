/**
 * ClipboardBannerOverlay - Renders the clipboard detection banner as a global overlay.
 *
 * This component handles:
 * - Listening for TikTok/Instagram URLs on clipboard when app comes to foreground
 * - Displaying the ClipboardBanner overlay on any screen
 * - Navigating to ShareCaptureScreen when user taps "Save"
 * - Showing permission guidance banner when clipboard access is denied
 *
 * Must be rendered inside a NavigationContainer to have access to navigation.
 */

import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { CommonActions, useNavigation } from '@react-navigation/native';

import { useClipboardListener } from '@hooks/useClipboardListener';
import ClipboardBanner from './ClipboardBanner';
import ClipboardPermissionBanner from './ClipboardPermissionBanner';

/**
 * Standalone overlay component that can be rendered anywhere inside the navigation tree.
 * Renders an absolutely positioned banner when a clipboard URL is detected,
 * or a permission guidance banner when clipboard access is denied.
 */
export function ClipboardBannerOverlay() {
  const navigation = useNavigation();
  const { detectedUrl, dismiss, clear, hasPermissionError, acknowledgePermissionError } =
    useClipboardListener();

  const handleSave = useCallback(() => {
    if (!detectedUrl) return;
    clear();
    // Navigate to ShareCapture within the Main (Passport) navigator
    // We need to specify the nested path: Main -> ShareCapture
    navigation.dispatch(
      CommonActions.navigate({
        name: 'Main',
        params: {
          screen: 'ShareCapture',
          params: {
            url: detectedUrl.url,
            source: 'clipboard',
          },
        },
      })
    );
  }, [detectedUrl, clear, navigation]);

  // Show permission error banner if clipboard access was denied
  if (hasPermissionError) {
    return (
      <ClipboardPermissionBanner
        onOpenSettings={acknowledgePermissionError}
        onDismiss={acknowledgePermissionError}
      />
    );
  }

  // Show detected URL banner
  if (detectedUrl) {
    return (
      <ClipboardBanner provider={detectedUrl.provider} onSave={handleSave} onDismiss={dismiss} />
    );
  }

  return null;
}

interface ProviderProps {
  children: React.ReactNode;
}

/**
 * Provider wrapper that includes the ClipboardBannerOverlay.
 * Use this to wrap content that's already inside a navigator.
 */
export function ClipboardBannerProvider({ children }: ProviderProps) {
  return (
    <View style={styles.container}>
      {children}
      <ClipboardBannerOverlay />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});

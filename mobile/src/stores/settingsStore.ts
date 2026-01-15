import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface SettingsState {
  // Clipboard URL detection
  clipboardDetectionEnabled: boolean;

  // Share extension tutorial
  hasUsedShareExtension: boolean;
  shareExtensionTutorialDismissedAt: number | null; // Timestamp for session dismissal

  // Actions
  setClipboardDetectionEnabled: (enabled: boolean) => void;
  setHasUsedShareExtension: (used: boolean) => void;
  dismissShareExtensionTutorial: () => void;
  resetShareExtensionTutorialDismissal: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      clipboardDetectionEnabled: false,
      hasUsedShareExtension: false,
      shareExtensionTutorialDismissedAt: null,

      setClipboardDetectionEnabled: (enabled) => set({ clipboardDetectionEnabled: enabled }),
      setHasUsedShareExtension: (used) => set({ hasUsedShareExtension: used }),
      dismissShareExtensionTutorial: () => set({ shareExtensionTutorialDismissedAt: Date.now() }),
      resetShareExtensionTutorialDismissal: () => set({ shareExtensionTutorialDismissedAt: null }),
    }),
    {
      name: 'settings-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

// Selectors
export const selectClipboardDetectionEnabled = (state: SettingsState) =>
  state.clipboardDetectionEnabled;

export const selectHasUsedShareExtension = (state: SettingsState) => state.hasUsedShareExtension;

export const selectShareExtensionTutorialDismissedAt = (state: SettingsState) =>
  state.shareExtensionTutorialDismissedAt;

/**
 * Returns true if the share extension tutorial callout should be shown.
 * Conditions:
 * - User has NOT used share extension (permanent dismissal)
 * - User has NOT dismissed the callout in this session (session dismissal)
 * - Platform is iOS (share extension is iOS-only)
 */
export const selectShouldShowShareExtensionTutorial = (state: SettingsState) => {
  // Permanent dismissal: user has used share extension
  if (state.hasUsedShareExtension) return false;

  // Session dismissal: check if dismissed within last 24 hours
  // (we use 24 hours instead of true session to handle app backgrounding)
  if (state.shareExtensionTutorialDismissedAt) {
    const twentyFourHours = 24 * 60 * 60 * 1000;
    const elapsed = Date.now() - state.shareExtensionTutorialDismissedAt;
    if (elapsed < twentyFourHours) return false;
  }

  return true;
};

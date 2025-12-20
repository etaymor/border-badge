import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface SettingsState {
  // Clipboard URL detection
  clipboardDetectionEnabled: boolean;

  // Actions
  setClipboardDetectionEnabled: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      clipboardDetectionEnabled: true,

      setClipboardDetectionEnabled: (enabled) => set({ clipboardDetectionEnabled: enabled }),
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

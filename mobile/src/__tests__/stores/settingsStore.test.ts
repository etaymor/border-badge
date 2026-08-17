/**
 * Tests for the Settings Store.
 *
 * Tests state management for user settings including clipboard detection
 * and share extension tutorial visibility.
 */

import {
  useSettingsStore,
  selectClipboardDetectionEnabled,
  selectHasUsedShareExtension,
  selectShareExtensionTutorialDismissedAt,
  selectShouldShowShareExtensionTutorial,
} from '@stores/settingsStore';

describe('settingsStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useSettingsStore.setState({
      clipboardDetectionEnabled: false,
      hasUsedShareExtension: false,
      shareExtensionTutorialDismissedAt: null,
    });
    jest.clearAllMocks();
  });

  describe('initial state', () => {
    it('starts with clipboard detection disabled', () => {
      const state = useSettingsStore.getState();
      expect(state.clipboardDetectionEnabled).toBe(false);
    });

    it('starts with share extension not used', () => {
      const state = useSettingsStore.getState();
      expect(state.hasUsedShareExtension).toBe(false);
    });

    it('starts with no tutorial dismissal timestamp', () => {
      const state = useSettingsStore.getState();
      expect(state.shareExtensionTutorialDismissedAt).toBeNull();
    });
  });

  describe('setClipboardDetectionEnabled', () => {
    it('enables clipboard detection', () => {
      useSettingsStore.getState().setClipboardDetectionEnabled(true);
      expect(useSettingsStore.getState().clipboardDetectionEnabled).toBe(true);
    });

    it('disables clipboard detection', () => {
      useSettingsStore.setState({ clipboardDetectionEnabled: true });
      useSettingsStore.getState().setClipboardDetectionEnabled(false);
      expect(useSettingsStore.getState().clipboardDetectionEnabled).toBe(false);
    });
  });

  describe('setHasUsedShareExtension', () => {
    it('sets share extension usage to true', () => {
      useSettingsStore.getState().setHasUsedShareExtension(true);
      expect(useSettingsStore.getState().hasUsedShareExtension).toBe(true);
    });

    it('sets share extension usage to false', () => {
      useSettingsStore.setState({ hasUsedShareExtension: true });
      useSettingsStore.getState().setHasUsedShareExtension(false);
      expect(useSettingsStore.getState().hasUsedShareExtension).toBe(false);
    });
  });

  describe('dismissShareExtensionTutorial', () => {
    it('sets dismissal timestamp to current time', () => {
      const beforeTime = Date.now();
      useSettingsStore.getState().dismissShareExtensionTutorial();
      const afterTime = Date.now();

      const timestamp = useSettingsStore.getState().shareExtensionTutorialDismissedAt;
      expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(timestamp).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('resetShareExtensionTutorialDismissal', () => {
    it('clears dismissal timestamp', () => {
      useSettingsStore.setState({ shareExtensionTutorialDismissedAt: Date.now() });
      useSettingsStore.getState().resetShareExtensionTutorialDismissal();
      expect(useSettingsStore.getState().shareExtensionTutorialDismissedAt).toBeNull();
    });
  });

  describe('selectors', () => {
    describe('selectClipboardDetectionEnabled', () => {
      it('returns clipboard detection enabled state', () => {
        const state = useSettingsStore.getState();
        expect(selectClipboardDetectionEnabled(state)).toBe(false);

        useSettingsStore.setState({ clipboardDetectionEnabled: true });
        expect(selectClipboardDetectionEnabled(useSettingsStore.getState())).toBe(true);
      });
    });

    describe('selectHasUsedShareExtension', () => {
      it('returns share extension usage state', () => {
        const state = useSettingsStore.getState();
        expect(selectHasUsedShareExtension(state)).toBe(false);

        useSettingsStore.setState({ hasUsedShareExtension: true });
        expect(selectHasUsedShareExtension(useSettingsStore.getState())).toBe(true);
      });
    });

    describe('selectShareExtensionTutorialDismissedAt', () => {
      it('returns dismissal timestamp', () => {
        const state = useSettingsStore.getState();
        expect(selectShareExtensionTutorialDismissedAt(state)).toBeNull();

        const timestamp = Date.now();
        useSettingsStore.setState({ shareExtensionTutorialDismissedAt: timestamp });
        expect(selectShareExtensionTutorialDismissedAt(useSettingsStore.getState())).toBe(
          timestamp
        );
      });
    });

    describe('selectShouldShowShareExtensionTutorial', () => {
      it('returns true when never dismissed and share extension not used', () => {
        const state = useSettingsStore.getState();
        expect(selectShouldShowShareExtensionTutorial(state)).toBe(true);
      });

      it('returns false when share extension has been used (permanent dismissal)', () => {
        useSettingsStore.setState({ hasUsedShareExtension: true });
        expect(selectShouldShowShareExtensionTutorial(useSettingsStore.getState())).toBe(false);
      });

      it('returns false when dismissed within last 24 hours', () => {
        // Dismissed 1 hour ago
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        useSettingsStore.setState({ shareExtensionTutorialDismissedAt: oneHourAgo });
        expect(selectShouldShowShareExtensionTutorial(useSettingsStore.getState())).toBe(false);
      });

      it('returns false when dismissed at boundary (23 hours 59 minutes ago)', () => {
        // Just under 24 hours ago
        const justUnder24Hours = Date.now() - (24 * 60 * 60 * 1000 - 60000);
        useSettingsStore.setState({ shareExtensionTutorialDismissedAt: justUnder24Hours });
        expect(selectShouldShowShareExtensionTutorial(useSettingsStore.getState())).toBe(false);
      });

      it('returns true when dismissed more than 24 hours ago', () => {
        // 25 hours ago
        const twentyFiveHoursAgo = Date.now() - 25 * 60 * 60 * 1000;
        useSettingsStore.setState({ shareExtensionTutorialDismissedAt: twentyFiveHoursAgo });
        expect(selectShouldShowShareExtensionTutorial(useSettingsStore.getState())).toBe(true);
      });

      it('returns false when share extension used, even if dismissed long ago', () => {
        // Permanently dismissed (used share extension) takes precedence
        useSettingsStore.setState({
          hasUsedShareExtension: true,
          shareExtensionTutorialDismissedAt: Date.now() - 48 * 60 * 60 * 1000, // 48 hours ago
        });
        expect(selectShouldShowShareExtensionTutorial(useSettingsStore.getState())).toBe(false);
      });
    });
  });
});

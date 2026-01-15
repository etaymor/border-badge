/**
 * Tests for ShareExtensionCallout component.
 *
 * Tests the promotional callout that encourages users to use the iOS share extension.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { ShareExtensionCallout } from '@components/share/ShareExtensionCallout';
import { useSettingsStore } from '@stores/settingsStore';

// Get reference to mocked haptics
const Haptics = jest.requireMock('expo-haptics');

describe('ShareExtensionCallout', () => {
  const mockOnLearnMore = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset store to initial state (tutorial should show)
    useSettingsStore.setState({
      clipboardDetectionEnabled: false,
      hasUsedShareExtension: false,
      shareExtensionTutorialDismissedAt: null,
    });
    // Default to iOS
    Platform.OS = 'ios';
  });

  afterEach(() => {
    // Restore platform
    Platform.OS = 'ios';
  });

  describe('platform behavior', () => {
    it('renders on iOS when tutorial should show', () => {
      Platform.OS = 'ios';
      render(<ShareExtensionCallout onLearnMore={mockOnLearnMore} />);

      expect(screen.getByText('Need Inspiration?')).toBeTruthy();
    });

    it('returns null on Android', () => {
      Platform.OS = 'android';
      const { toJSON } = render(<ShareExtensionCallout onLearnMore={mockOnLearnMore} />);

      expect(toJSON()).toBeNull();
    });
  });

  describe('visibility based on tutorial state', () => {
    it('renders when user has not used share extension and not dismissed', () => {
      useSettingsStore.setState({
        hasUsedShareExtension: false,
        shareExtensionTutorialDismissedAt: null,
      });

      render(<ShareExtensionCallout onLearnMore={mockOnLearnMore} />);

      expect(screen.getByText('Need Inspiration?')).toBeTruthy();
    });

    it('returns null when user has used share extension (permanent dismissal)', () => {
      useSettingsStore.setState({
        hasUsedShareExtension: true,
        shareExtensionTutorialDismissedAt: null,
      });

      const { toJSON } = render(<ShareExtensionCallout onLearnMore={mockOnLearnMore} />);

      expect(toJSON()).toBeNull();
    });

    it('returns null when dismissed within 24 hours (session dismissal)', () => {
      useSettingsStore.setState({
        hasUsedShareExtension: false,
        shareExtensionTutorialDismissedAt: Date.now() - 60 * 60 * 1000, // 1 hour ago
      });

      const { toJSON } = render(<ShareExtensionCallout onLearnMore={mockOnLearnMore} />);

      expect(toJSON()).toBeNull();
    });

    it('renders when dismissed more than 24 hours ago', () => {
      useSettingsStore.setState({
        hasUsedShareExtension: false,
        shareExtensionTutorialDismissedAt: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
      });

      render(<ShareExtensionCallout onLearnMore={mockOnLearnMore} />);

      expect(screen.getByText('Need Inspiration?')).toBeTruthy();
    });
  });

  describe('content', () => {
    it('displays title text', () => {
      render(<ShareExtensionCallout onLearnMore={mockOnLearnMore} />);

      expect(screen.getByText('Need Inspiration?')).toBeTruthy();
    });

    it('displays subtitle text', () => {
      render(<ShareExtensionCallout onLearnMore={mockOnLearnMore} />);

      expect(
        screen.getByText('Save ideas from TikTok and Instagram directly to your trips.')
      ).toBeTruthy();
    });

    it('displays dismiss button with correct accessibility label', () => {
      render(<ShareExtensionCallout onLearnMore={mockOnLearnMore} />);

      expect(screen.getByLabelText('Dismiss')).toBeTruthy();
    });

    it('displays learn more button with correct accessibility label', () => {
      render(<ShareExtensionCallout onLearnMore={mockOnLearnMore} />);

      expect(screen.getByLabelText('Learn how to save from TikTok and Instagram')).toBeTruthy();
    });
  });

  describe('interactions', () => {
    it('calls onLearnMore when help button is pressed', () => {
      render(<ShareExtensionCallout onLearnMore={mockOnLearnMore} />);

      fireEvent.press(screen.getByLabelText('Learn how to save from TikTok and Instagram'));

      expect(mockOnLearnMore).toHaveBeenCalledTimes(1);
    });

    it('triggers haptic feedback when help button is pressed', () => {
      render(<ShareExtensionCallout onLearnMore={mockOnLearnMore} />);

      fireEvent.press(screen.getByLabelText('Learn how to save from TikTok and Instagram'));

      expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
    });

    it('dismisses tutorial when dismiss button is pressed', () => {
      render(<ShareExtensionCallout onLearnMore={mockOnLearnMore} />);

      fireEvent.press(screen.getByLabelText('Dismiss'));

      // Should have set a dismissal timestamp
      const state = useSettingsStore.getState();
      expect(state.shareExtensionTutorialDismissedAt).not.toBeNull();
    });

    it('triggers haptic feedback when dismiss button is pressed', () => {
      render(<ShareExtensionCallout onLearnMore={mockOnLearnMore} />);

      fireEvent.press(screen.getByLabelText('Dismiss'));

      expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
    });
  });
});

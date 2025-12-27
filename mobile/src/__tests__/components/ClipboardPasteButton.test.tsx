/**
 * Tests for ClipboardPasteButton component.
 * Tests iOS-only behavior, platform checks, and paste handling.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { ClipboardPasteButton } from '@components/share/ClipboardPasteButton';

// Mock expo-clipboard
jest.mock('expo-clipboard', () => ({
  ClipboardPasteButton: jest.fn(
    ({
      onPress,
      style,
    }: {
      onPress: (data: unknown) => void;
      displayMode: string;
      style: unknown;
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const RN = require('react-native');
      return (
        <RN.TouchableOpacity
          onPress={() => onPress({ type: 'plain-text', text: 'https://tiktok.com/test' })}
          testID="expo-paste-button"
        >
          <RN.View style={style}>
            <RN.Text>Paste</RN.Text>
          </RN.View>
        </RN.TouchableOpacity>
      );
    }
  ),
  isPasteButtonAvailable: true,
}));

// Mock expo-haptics
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: 'medium', Light: 'light' },
  NotificationFeedbackType: { Warning: 'warning', Success: 'success' },
}));

// Save original Platform.OS
const originalPlatformOS = Platform.OS;

describe('ClipboardPasteButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default to iOS for most tests
    Platform.OS = 'ios';
  });

  afterEach(() => {
    Platform.OS = originalPlatformOS;
  });

  describe('Platform checks', () => {
    it('returns null on Android', () => {
      Platform.OS = 'android';

      const onDetect = jest.fn();
      const result = render(<ClipboardPasteButton onDetect={onDetect} />);

      // Component should not render anything
      expect(result.toJSON()).toBeNull();
    });

    it('renders on iOS', () => {
      Platform.OS = 'ios';

      const onDetect = jest.fn();
      render(<ClipboardPasteButton onDetect={onDetect} />);

      // Should render the paste button
      expect(screen.getByTestId('expo-paste-button')).toBeTruthy();
    });
  });

  describe('Paste handling', () => {
    it('calls onDetect with detected URL when valid TikTok URL is pasted', () => {
      Platform.OS = 'ios';
      const onDetect = jest.fn();

      render(<ClipboardPasteButton onDetect={onDetect} />);

      // Simulate paste by pressing the mocked button
      fireEvent.press(screen.getByTestId('expo-paste-button'));

      expect(onDetect).toHaveBeenCalledWith({
        url: 'https://tiktok.com/test',
        provider: 'tiktok',
      });
    });
  });

  describe('Accessibility', () => {
    it('has accessible paste button', () => {
      Platform.OS = 'ios';

      render(<ClipboardPasteButton onDetect={jest.fn()} />);

      // The expo paste button should be present
      expect(screen.getByTestId('expo-paste-button')).toBeTruthy();
    });
  });
});

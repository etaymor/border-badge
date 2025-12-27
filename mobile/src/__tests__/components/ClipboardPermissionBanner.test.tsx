/**
 * Tests for ClipboardPermissionBanner component.
 * Tests rendering, animations, and button interactions.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ClipboardPermissionBanner from '@components/share/ClipboardPermissionBanner';

// Mock expo-haptics
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: 'medium', Light: 'light' },
}));

// Save original Platform.OS
const originalPlatformOS = Platform.OS;

// Wrapper with SafeAreaProvider
function TestWrapper({ children }: { children: React.ReactNode }) {
  return <SafeAreaProvider>{children}</SafeAreaProvider>;
}

describe('ClipboardPermissionBanner', () => {
  const defaultProps = {
    onOpenSettings: jest.fn(),
    onDismiss: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    Platform.OS = 'ios';
  });

  afterEach(() => {
    jest.useRealTimers();
    Platform.OS = originalPlatformOS;
  });

  describe('Rendering', () => {
    it('renders permission banner with correct title', () => {
      render(<ClipboardPermissionBanner {...defaultProps} />, { wrapper: TestWrapper });

      expect(screen.getByText('Permission Needed')).toBeTruthy();
    });

    it('renders subtitle explaining the permission', () => {
      render(<ClipboardPermissionBanner {...defaultProps} />, { wrapper: TestWrapper });

      expect(screen.getByText('Enable clipboard to detect links')).toBeTruthy();
    });

    it('renders Settings button', () => {
      render(<ClipboardPermissionBanner {...defaultProps} />, { wrapper: TestWrapper });

      expect(screen.getByText('Settings')).toBeTruthy();
    });
  });

  describe('Settings button', () => {
    it('calls onOpenSettings when Settings button is pressed', async () => {
      Platform.OS = 'ios';
      const onOpenSettings = jest.fn();
      render(<ClipboardPermissionBanner {...defaultProps} onOpenSettings={onOpenSettings} />, {
        wrapper: TestWrapper,
      });

      const settingsButton = screen.getByText('Settings');
      fireEvent.press(settingsButton);

      expect(onOpenSettings).toHaveBeenCalled();
    });

    it('has correct accessibility label for Settings button', () => {
      render(<ClipboardPermissionBanner {...defaultProps} />, { wrapper: TestWrapper });

      expect(screen.getByLabelText('Open iOS Settings')).toBeTruthy();
    });
  });

  describe('Dismiss button', () => {
    it('calls onDismiss callback after animation when pressed', async () => {
      const onDismiss = jest.fn();
      render(<ClipboardPermissionBanner {...defaultProps} onDismiss={onDismiss} />, {
        wrapper: TestWrapper,
      });

      const dismissButton = screen.getByLabelText('Dismiss permission prompt');
      fireEvent.press(dismissButton);

      // Advance animation timer
      act(() => {
        jest.advanceTimersByTime(250);
      });

      await waitFor(() => {
        expect(onDismiss).toHaveBeenCalled();
      });
    });

    it('has correct accessibility label for dismiss button', () => {
      render(<ClipboardPermissionBanner {...defaultProps} />, { wrapper: TestWrapper });

      expect(screen.getByLabelText('Dismiss permission prompt')).toBeTruthy();
    });

    it('has correct accessibility role for dismiss button', () => {
      render(<ClipboardPermissionBanner {...defaultProps} />, { wrapper: TestWrapper });

      const dismissButton = screen.getByLabelText('Dismiss permission prompt');
      expect(dismissButton.props.accessibilityRole).toBe('button');
    });
  });

  describe('Accessibility', () => {
    it('Settings button has button role', () => {
      render(<ClipboardPermissionBanner {...defaultProps} />, { wrapper: TestWrapper });

      const settingsButton = screen.getByLabelText('Open iOS Settings');
      expect(settingsButton.props.accessibilityRole).toBe('button');
    });

    it('all interactive elements are accessible', () => {
      render(<ClipboardPermissionBanner {...defaultProps} />, { wrapper: TestWrapper });

      // Both buttons should have proper accessibility labels
      expect(screen.getByLabelText('Open iOS Settings')).toBeTruthy();
      expect(screen.getByLabelText('Dismiss permission prompt')).toBeTruthy();
    });
  });

  describe('Haptic feedback', () => {
    it('triggers haptic feedback on Settings button press', async () => {
      const Haptics = jest.requireMock('expo-haptics');
      render(<ClipboardPermissionBanner {...defaultProps} />, { wrapper: TestWrapper });

      const settingsButton = screen.getByText('Settings');
      fireEvent.press(settingsButton);

      expect(Haptics.impactAsync).toHaveBeenCalledWith('medium');
    });

    it('triggers haptic feedback on dismiss button press', async () => {
      const Haptics = jest.requireMock('expo-haptics');
      render(<ClipboardPermissionBanner {...defaultProps} />, { wrapper: TestWrapper });

      const dismissButton = screen.getByLabelText('Dismiss permission prompt');
      fireEvent.press(dismissButton);

      expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
    });
  });
});

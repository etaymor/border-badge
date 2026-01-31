/**
 * Tests for SatisfactionModal Component
 *
 * Tests button interactions, callback invocations, and URL handling
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import * as Haptics from 'expo-haptics';

import { SatisfactionModal } from '@components/review/SatisfactionModal';
import { Analytics } from '@services/analytics';

// Mock Haptics
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: {
    Light: 'light',
  },
}));

// Mock Analytics
jest.mock('@services/analytics', () => ({
  Analytics: {
    reviewSupportLinkTapped: jest.fn(),
  },
}));

// Mock environment config
jest.mock('@config/env', () => ({
  env: {
    webBaseUrl: 'http://example.com',
  },
}));

describe('SatisfactionModal', () => {
  const mockOnPositive = jest.fn();
  const mockOnNegative = jest.fn();
  const mockOnDismiss = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    // Use spyOn to mock Linking methods
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as unknown as void);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('visibility', () => {
    it('renders modal when visible is true', () => {
      const { getByText } = render(
        <SatisfactionModal
          visible={true}
          onPositive={mockOnPositive}
          onNegative={mockOnNegative}
          onDismiss={mockOnDismiss}
        />
      );

      expect(getByText('How are you enjoying Atlasi?')).toBeTruthy();
    });

    it('does not render modal content when visible is false', () => {
      const { queryByText } = render(
        <SatisfactionModal
          visible={false}
          onPositive={mockOnPositive}
          onNegative={mockOnNegative}
          onDismiss={mockOnDismiss}
        />
      );

      expect(queryByText('How are you enjoying Atlasi?')).toBeFalsy();
    });
  });

  describe('positive button', () => {
    it('calls onPositive when positive button is pressed', async () => {
      const { getByLabelText } = render(
        <SatisfactionModal
          visible={true}
          onPositive={mockOnPositive}
          onNegative={mockOnNegative}
          onDismiss={mockOnDismiss}
        />
      );

      const positiveButton = getByLabelText('I love Atlasi');
      fireEvent.press(positiveButton);

      await waitFor(() => {
        expect(mockOnPositive).toHaveBeenCalledTimes(1);
      });
    });

    it('provides haptic feedback on positive button press', async () => {
      const { getByLabelText } = render(
        <SatisfactionModal
          visible={true}
          onPositive={mockOnPositive}
          onNegative={mockOnNegative}
          onDismiss={mockOnDismiss}
        />
      );

      const positiveButton = getByLabelText('I love Atlasi');
      fireEvent.press(positiveButton);

      await waitFor(() => {
        expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
      });
    });

    it('continues despite haptic feedback failure', async () => {
      (Haptics.impactAsync as jest.Mock).mockRejectedValueOnce(new Error('Haptics unavailable'));

      const { getByLabelText } = render(
        <SatisfactionModal
          visible={true}
          onPositive={mockOnPositive}
          onNegative={mockOnNegative}
          onDismiss={mockOnDismiss}
        />
      );

      const positiveButton = getByLabelText('I love Atlasi');
      fireEvent.press(positiveButton);

      await waitFor(() => {
        expect(mockOnPositive).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('negative button', () => {
    it('calls onNegative when negative button is pressed', async () => {
      (Linking.canOpenURL as jest.Mock).mockResolvedValue(false);

      const { getByLabelText } = render(
        <SatisfactionModal
          visible={true}
          onPositive={mockOnPositive}
          onNegative={mockOnNegative}
          onDismiss={mockOnDismiss}
        />
      );

      const negativeButton = getByLabelText('Could be better');
      fireEvent.press(negativeButton);

      await waitFor(() => {
        expect(mockOnNegative).toHaveBeenCalledTimes(1);
      });
    });

    it('provides haptic feedback on negative button press', async () => {
      (Linking.canOpenURL as jest.Mock).mockResolvedValue(false);

      const { getByLabelText } = render(
        <SatisfactionModal
          visible={true}
          onPositive={mockOnPositive}
          onNegative={mockOnNegative}
          onDismiss={mockOnDismiss}
        />
      );

      const negativeButton = getByLabelText('Could be better');
      fireEvent.press(negativeButton);

      await waitFor(() => {
        expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
      });
    });

    it('opens contact page when URL is available', async () => {
      (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);

      const { getByLabelText } = render(
        <SatisfactionModal
          visible={true}
          onPositive={mockOnPositive}
          onNegative={mockOnNegative}
          onDismiss={mockOnDismiss}
        />
      );

      const negativeButton = getByLabelText('Could be better');
      fireEvent.press(negativeButton);

      await waitFor(() => {
        expect(Linking.openURL).toHaveBeenCalledWith('http://example.com/contact');
      });
    });

    it('records analytics when opening contact page', async () => {
      (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);

      const { getByLabelText } = render(
        <SatisfactionModal
          visible={true}
          onPositive={mockOnPositive}
          onNegative={mockOnNegative}
          onDismiss={mockOnDismiss}
        />
      );

      const negativeButton = getByLabelText('Could be better');
      fireEvent.press(negativeButton);

      await waitFor(() => {
        expect(Analytics.reviewSupportLinkTapped).toHaveBeenCalled();
      });
    });

    it('does not open URL when canOpenURL returns false', async () => {
      (Linking.canOpenURL as jest.Mock).mockResolvedValue(false);

      const { getByLabelText } = render(
        <SatisfactionModal
          visible={true}
          onPositive={mockOnPositive}
          onNegative={mockOnNegative}
          onDismiss={mockOnDismiss}
        />
      );

      const negativeButton = getByLabelText('Could be better');
      fireEvent.press(negativeButton);

      await waitFor(() => {
        expect(mockOnNegative).toHaveBeenCalled();
        expect(Linking.openURL).not.toHaveBeenCalled();
      });
    });

    it('handles URL opening errors gracefully', async () => {
      (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);
      (Linking.openURL as jest.Mock).mockRejectedValue(new Error('Failed to open URL'));

      const { getByLabelText } = render(
        <SatisfactionModal
          visible={true}
          onPositive={mockOnPositive}
          onNegative={mockOnNegative}
          onDismiss={mockOnDismiss}
        />
      );

      const negativeButton = getByLabelText('Could be better');
      fireEvent.press(negativeButton);

      await waitFor(() => {
        expect(mockOnNegative).toHaveBeenCalled();
        // Should still complete despite error
      });
    });

    it('continues despite haptic feedback failure on negative button', async () => {
      (Haptics.impactAsync as jest.Mock).mockRejectedValueOnce(new Error('Haptics unavailable'));
      (Linking.canOpenURL as jest.Mock).mockResolvedValue(false);

      const { getByLabelText } = render(
        <SatisfactionModal
          visible={true}
          onPositive={mockOnPositive}
          onNegative={mockOnNegative}
          onDismiss={mockOnDismiss}
        />
      );

      const negativeButton = getByLabelText('Could be better');
      fireEvent.press(negativeButton);

      await waitFor(() => {
        expect(mockOnNegative).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('dismiss button', () => {
    it('calls onDismiss when "Not now" button is pressed', async () => {
      const { getByLabelText } = render(
        <SatisfactionModal
          visible={true}
          onPositive={mockOnPositive}
          onNegative={mockOnNegative}
          onDismiss={mockOnDismiss}
        />
      );

      const dismissButton = getByLabelText('Not now');
      fireEvent.press(dismissButton);

      expect(mockOnDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe('text content', () => {
    it('displays correct title', () => {
      const { getByText } = render(
        <SatisfactionModal
          visible={true}
          onPositive={mockOnPositive}
          onNegative={mockOnNegative}
          onDismiss={mockOnDismiss}
        />
      );

      expect(getByText('How are you enjoying Atlasi?')).toBeTruthy();
    });

    it('displays correct subtitle', () => {
      const { getByText } = render(
        <SatisfactionModal
          visible={true}
          onPositive={mockOnPositive}
          onNegative={mockOnNegative}
          onDismiss={mockOnDismiss}
        />
      );

      expect(getByText('Your feedback helps us improve the app for everyone.')).toBeTruthy();
    });

    it('displays correct positive button text', () => {
      const { getByText } = render(
        <SatisfactionModal
          visible={true}
          onPositive={mockOnPositive}
          onNegative={mockOnNegative}
          onDismiss={mockOnDismiss}
        />
      );

      expect(getByText('I love it!')).toBeTruthy();
    });

    it('displays correct negative button text', () => {
      const { getByText } = render(
        <SatisfactionModal
          visible={true}
          onPositive={mockOnPositive}
          onNegative={mockOnNegative}
          onDismiss={mockOnDismiss}
        />
      );

      expect(getByText('Could be better')).toBeTruthy();
    });

    it('displays dismiss button text', () => {
      const { getByText } = render(
        <SatisfactionModal
          visible={true}
          onPositive={mockOnPositive}
          onNegative={mockOnNegative}
          onDismiss={mockOnDismiss}
        />
      );

      expect(getByText('Not now')).toBeTruthy();
    });
  });

  describe('accessibility', () => {
    it('sets correct accessibility role for positive button', () => {
      const { getByLabelText } = render(
        <SatisfactionModal
          visible={true}
          onPositive={mockOnPositive}
          onNegative={mockOnNegative}
          onDismiss={mockOnDismiss}
        />
      );

      const positiveButton = getByLabelText('I love Atlasi');
      expect(positiveButton.props.accessibilityRole).toBe('button');
    });

    it('sets correct accessibility role for negative button', () => {
      const { getByLabelText } = render(
        <SatisfactionModal
          visible={true}
          onPositive={mockOnPositive}
          onNegative={mockOnNegative}
          onDismiss={mockOnDismiss}
        />
      );

      const negativeButton = getByLabelText('Could be better');
      expect(negativeButton.props.accessibilityRole).toBe('button');
    });
  });
});

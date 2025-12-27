/**
 * Tests for ClipboardPermissionModal component.
 * Tests modal rendering, interactions, and accessibility.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { ClipboardPermissionModal } from '@screens/profile/components/ClipboardPermissionModal';

// Save original Platform.OS
const originalPlatformOS = Platform.OS;

describe('ClipboardPermissionModal', () => {
  const defaultProps = {
    visible: true,
    onClose: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'ios';
  });

  afterEach(() => {
    Platform.OS = originalPlatformOS;
  });

  describe('Rendering when visible', () => {
    it('renders modal title', () => {
      render(<ClipboardPermissionModal {...defaultProps} />);

      expect(screen.getByText('Clipboard Permissions')).toBeTruthy();
    });

    it('renders modal subtitle', () => {
      render(<ClipboardPermissionModal {...defaultProps} />);

      expect(screen.getByText('How to stop the "Allow Paste" popup on iOS')).toBeTruthy();
    });

    it('renders "Why this happens" section', () => {
      render(<ClipboardPermissionModal {...defaultProps} />);

      expect(screen.getByText('Why this happens')).toBeTruthy();
    });

    it('renders "How to allow permanently" section', () => {
      render(<ClipboardPermissionModal {...defaultProps} />);

      expect(screen.getByText('How to allow permanently')).toBeTruthy();
    });

    it('renders Alternative section', () => {
      render(<ClipboardPermissionModal {...defaultProps} />);

      expect(screen.getByText('Alternative')).toBeTruthy();
    });

    it('renders "Got it" close button', () => {
      render(<ClipboardPermissionModal {...defaultProps} />);

      expect(screen.getByText('Got it')).toBeTruthy();
    });

    it('renders "Open Settings" button', () => {
      render(<ClipboardPermissionModal {...defaultProps} />);

      expect(screen.getByText('Open Settings')).toBeTruthy();
    });
  });

  describe('Rendering when not visible', () => {
    it('does not render content when visible is false', () => {
      render(<ClipboardPermissionModal visible={false} onClose={jest.fn()} />);

      expect(screen.queryByText('Clipboard Permissions')).toBeNull();
    });
  });

  describe('Interactions', () => {
    it('calls onClose when "Got it" button is pressed', () => {
      const onClose = jest.fn();
      render(<ClipboardPermissionModal visible={true} onClose={onClose} />);

      const gotItButton = screen.getByText('Got it');
      fireEvent.press(gotItButton);

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Accessibility', () => {
    it('modal content has all sections', () => {
      render(<ClipboardPermissionModal {...defaultProps} />);

      // All sections should be visible
      expect(screen.getByText('Why this happens')).toBeTruthy();
      expect(screen.getByText('How to allow permanently')).toBeTruthy();
      expect(screen.getByText('Alternative')).toBeTruthy();
    });

    it('Got it button has accessibility role', () => {
      render(<ClipboardPermissionModal {...defaultProps} />);

      const gotItButton = screen.getByLabelText('Got it');
      expect(gotItButton.props.accessibilityRole).toBe('button');
    });

    it('Open Settings button has accessibility role', () => {
      render(<ClipboardPermissionModal {...defaultProps} />);

      const openSettingsButton = screen.getByLabelText('Open Settings');
      expect(openSettingsButton.props.accessibilityRole).toBe('button');
    });
  });
});

/**
 * Tests for authErrors utility functions.
 */

import {
  isUserCancellation,
  getAuthErrorMessage,
  getSafeLogMessage,
} from '@utils/authErrors';

describe('authErrors', () => {
  describe('isUserCancellation', () => {
    it('returns true for "cancel" in message', () => {
      expect(isUserCancellation(new Error('User did cancel'))).toBe(true);
    });

    it('returns true for "cancelled" in message', () => {
      expect(isUserCancellation(new Error('Request was cancelled'))).toBe(true);
    });

    it('returns true for "canceled" in message', () => {
      expect(isUserCancellation(new Error('Operation was canceled'))).toBe(true);
    });

    it('returns true for "ERR_REQUEST_CANCELED"', () => {
      expect(isUserCancellation(new Error('ERR_REQUEST_CANCELED'))).toBe(true);
    });

    it('returns true for "dismiss" in message', () => {
      expect(isUserCancellation(new Error('User did dismiss the modal'))).toBe(true);
    });

    it('returns true for "1001" (Apple cancellation code)', () => {
      expect(isUserCancellation(new Error('Error 1001: User cancelled'))).toBe(true);
    });

    it('returns false for network errors', () => {
      expect(isUserCancellation(new Error('Network request failed'))).toBe(false);
    });

    it('returns false for auth errors', () => {
      expect(isUserCancellation(new Error('Invalid credentials'))).toBe(false);
    });

    it('returns false for non-Error objects', () => {
      expect(isUserCancellation('string error')).toBe(false);
      expect(isUserCancellation(null)).toBe(false);
      expect(isUserCancellation(undefined)).toBe(false);
    });
  });

  describe('getAuthErrorMessage', () => {
    it('returns null for user cancellation', () => {
      expect(getAuthErrorMessage(new Error('ERR_REQUEST_CANCELED'))).toBeNull();
      expect(getAuthErrorMessage(new Error('User cancelled'))).toBeNull();
      expect(getAuthErrorMessage(new Error('User did dismiss'))).toBeNull();
    });

    it('returns friendly message for network errors', () => {
      const message = getAuthErrorMessage(new Error('Network request failed'));
      expect(message).toBe('Connection failed. Please check your internet.');
    });

    it('returns friendly message for rate limit', () => {
      const message = getAuthErrorMessage(new Error('Rate limit exceeded'));
      expect(message).toBe('Too many attempts. Please wait a moment.');
    });

    it('returns friendly message for invalid email', () => {
      const message = getAuthErrorMessage(new Error('Invalid email'));
      expect(message).toBe('Please enter a valid email address.');
    });

    it('returns friendly message for email not confirmed', () => {
      const message = getAuthErrorMessage(new Error('Email not confirmed'));
      expect(message).toBe('Please check your email for the confirmation link.');
    });

    it('returns generic message for unknown errors', () => {
      const message = getAuthErrorMessage(new Error('Some weird internal error'));
      expect(message).toBe('Authentication failed. Please try again.');
    });

    it('returns generic message for non-Error objects', () => {
      expect(getAuthErrorMessage('string error')).toBe('Something went wrong. Please try again.');
      expect(getAuthErrorMessage(null)).toBe('Something went wrong. Please try again.');
      expect(getAuthErrorMessage({ code: 123 })).toBe('Something went wrong. Please try again.');
    });
  });

  describe('getSafeLogMessage', () => {
    it('redacts access_token from message', () => {
      const error = new Error('Failed at access_token=abc123xyz&other=data');
      expect(getSafeLogMessage(error)).toBe('Failed at access_token=[REDACTED]&other=data');
    });

    it('redacts refresh_token from message', () => {
      const error = new Error('Failed at refresh_token=secrettoken');
      expect(getSafeLogMessage(error)).toBe('Failed at refresh_token=[REDACTED]');
    });

    it('redacts token= from message', () => {
      const error = new Error('Error with token=mytoken123');
      expect(getSafeLogMessage(error)).toBe('Error with token=[REDACTED]');
    });

    it('redacts Bearer tokens from message', () => {
      const error = new Error('Auth header: Bearer abc123xyz');
      expect(getSafeLogMessage(error)).toBe('Auth header: Bearer [REDACTED]');
    });

    it('handles multiple tokens in same message', () => {
      const error = new Error('access_token=abc&refresh_token=def');
      const result = getSafeLogMessage(error);
      expect(result).toBe('access_token=[REDACTED]&refresh_token=[REDACTED]');
    });

    it('preserves messages without tokens', () => {
      const error = new Error('Network error occurred');
      expect(getSafeLogMessage(error)).toBe('Network error occurred');
    });

    it('handles non-Error objects', () => {
      expect(getSafeLogMessage('string error')).toBe('Unknown error type');
      expect(getSafeLogMessage(null)).toBe('Unknown error type');
    });
  });
});

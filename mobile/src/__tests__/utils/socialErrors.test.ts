/**
 * Tests for social error utilities.
 *
 * Covers:
 * - HTTP status code mapping
 * - Action-specific conflict messages
 * - Network and timeout error handling
 * - Fallback error messages
 */

import { getSocialErrorMessage } from '@utils/socialErrors';

// Mock AxiosError structure
function createAxiosError(status: number, code?: string): unknown {
  return {
    response: { status },
    code,
    message: 'Request failed',
  };
}

describe('getSocialErrorMessage', () => {
  describe('HTTP status codes', () => {
    it('returns 403 message for forbidden', () => {
      const error = createAxiosError(403);
      expect(getSocialErrorMessage(error, 'follow')).toBe('You cannot perform this action');
    });

    it('returns 404 message for not found', () => {
      const error = createAxiosError(404);
      expect(getSocialErrorMessage(error, 'follow')).toBe('User not found or was deleted');
    });

    it('returns 429 message for rate limiting', () => {
      const error = createAxiosError(429);
      expect(getSocialErrorMessage(error, 'follow')).toBe(
        'Too many requests. Please wait a moment'
      );
    });
  });

  describe('409 conflict - action-specific messages', () => {
    it('returns follow-specific message for 409', () => {
      const error = createAxiosError(409);
      expect(getSocialErrorMessage(error, 'follow')).toBe("You're already following this user");
    });

    it('returns unfollow-specific message for 409', () => {
      const error = createAxiosError(409);
      expect(getSocialErrorMessage(error, 'unfollow')).toBe("You're not following this user");
    });

    it('returns block-specific message for 409', () => {
      const error = createAxiosError(409);
      expect(getSocialErrorMessage(error, 'block')).toBe("You've already blocked this user");
    });

    it('returns unblock-specific message for 409', () => {
      const error = createAxiosError(409);
      expect(getSocialErrorMessage(error, 'unblock')).toBe('This user is not blocked');
    });

    it('returns generic 409 message for unknown action', () => {
      const error = createAxiosError(409);
      expect(getSocialErrorMessage(error, 'unknown')).toBe('This action was already completed');
    });
  });

  describe('network and timeout errors', () => {
    it('handles timeout with ECONNABORTED code', () => {
      const error = createAxiosError(0, 'ECONNABORTED');
      expect(getSocialErrorMessage(error, 'follow')).toBe('Connection timed out. Please try again');
    });

    it('handles timeout in error message', () => {
      const error = new Error('Request timeout exceeded');
      expect(getSocialErrorMessage(error, 'follow')).toBe('Connection timed out. Please try again');
    });

    it('handles network error in error message', () => {
      const error = new Error('Network Error');
      expect(getSocialErrorMessage(error, 'follow')).toBe('Network error. Check your connection');
    });
  });

  describe('fallback messages', () => {
    it('returns error message if available', () => {
      const error = new Error('Custom error message');
      expect(getSocialErrorMessage(error, 'follow')).toBe('Custom error message');
    });

    it('returns generic action message as last resort', () => {
      expect(getSocialErrorMessage({}, 'follow')).toBe('Failed to follow');
      expect(getSocialErrorMessage({}, 'unfollow')).toBe('Failed to unfollow');
      expect(getSocialErrorMessage({}, 'block')).toBe('Failed to block');
    });

    it('handles null/undefined errors', () => {
      expect(getSocialErrorMessage(null, 'follow')).toBe('Failed to follow');
      expect(getSocialErrorMessage(undefined, 'follow')).toBe('Failed to follow');
    });
  });

  describe('edge cases', () => {
    it('handles error without response property', () => {
      const error = { code: 'ERR_OTHER' };
      expect(getSocialErrorMessage(error, 'follow')).toBe('Failed to follow');
    });

    it('handles error with response but no status', () => {
      const error = { response: {} };
      expect(getSocialErrorMessage(error, 'follow')).toBe('Failed to follow');
    });

    it('prioritizes status code over error message', () => {
      const error = {
        response: { status: 404 },
        message: 'Request failed',
      };
      expect(getSocialErrorMessage(error, 'follow')).toBe('User not found or was deleted');
    });
  });
});

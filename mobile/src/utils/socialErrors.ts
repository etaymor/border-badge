/**
 * Social Error Utilities
 *
 * Provides user-friendly error messages for social features (follows, blocks).
 * Maps HTTP status codes and error patterns to clear messages.
 */

import type { AxiosError } from 'axios';

/**
 * HTTP status code to message mapping for social actions.
 */
const STATUS_MESSAGES: Record<number, string> = {
  403: 'You cannot perform this action',
  404: 'User not found or was deleted',
  409: 'This action was already completed',
  429: 'Too many requests. Please wait a moment',
};

/**
 * Action-specific messages for 409 Conflict.
 */
const CONFLICT_MESSAGES: Record<string, string> = {
  follow: "You're already following this user",
  unfollow: "You're not following this user",
  block: "You've already blocked this user",
  unblock: 'This user is not blocked',
};

/**
 * Get a user-friendly error message for social actions.
 *
 * @param error - The error from the API call
 * @param action - The action being performed (follow, unfollow, block, unblock)
 * @returns A user-friendly error message
 */
export function getSocialErrorMessage(error: unknown, action: string): string {
  // Check for axios error with response
  const axiosError = error as AxiosError;
  const status = axiosError?.response?.status;

  if (status) {
    // Use action-specific message for 409
    if (status === 409 && action in CONFLICT_MESSAGES) {
      return CONFLICT_MESSAGES[action];
    }

    // Use status-specific message if available
    if (status in STATUS_MESSAGES) {
      return STATUS_MESSAGES[status];
    }
  }

  // Check for timeout
  if (
    axiosError?.code === 'ECONNABORTED' ||
    (error instanceof Error && error.message.includes('timeout'))
  ) {
    return 'Connection timed out. Please try again';
  }

  // Check for network error
  if (error instanceof Error && error.message.includes('Network')) {
    return 'Network error. Check your connection';
  }

  // Fall back to error message or generic message
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return `Failed to ${action}`;
}

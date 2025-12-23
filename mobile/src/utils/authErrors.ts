/**
 * Auth Error Utilities
 *
 * Provides sanitized error messages for authentication flows.
 * Maps technical errors to user-friendly messages without exposing implementation details.
 */

/**
 * Known error message mappings.
 * Keys are substrings to match in error messages.
 */
const ERROR_MESSAGES: Record<string, string> = {
  'Network request failed': 'Connection failed. Please check your internet.',
  'Rate limit exceeded': 'Too many attempts. Please wait a moment.',
  'Invalid email': 'Please enter a valid email address.',
  'Email not confirmed': 'Please check your email for the confirmation link.',
  'Invalid login credentials': 'Invalid email or password.',
  'User not found': 'No account found with this email.',
  'Signup disabled': 'Account creation is currently unavailable.',
  'OAuth error': 'Sign-in failed. Please try again.',
  'Invalid OAuth callback': 'Authentication failed. Please try again.',
};

/**
 * Patterns that indicate user cancellation (should be silent).
 */
const CANCELLATION_PATTERNS = [
  'cancel',
  'cancelled',
  'canceled',
  'dismiss',
  'ERR_REQUEST_CANCELED',
  '1001', // Apple auth cancellation code
];

/**
 * Check if an error represents a user cancellation.
 */
export function isUserCancellation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return CANCELLATION_PATTERNS.some((pattern) => message.includes(pattern.toLowerCase()));
}

/**
 * Get a sanitized, user-friendly error message for auth errors.
 *
 * @param error - The error to convert to a message
 * @returns A user-friendly message, or null if the error should be silent (e.g., user cancellation)
 */
export function getAuthErrorMessage(error: unknown): string | null {
  // User cancellations should be silent
  if (isUserCancellation(error)) {
    return null;
  }

  // Non-Error objects get a generic message
  if (!(error instanceof Error)) {
    return 'Something went wrong. Please try again.';
  }

  const errorMessage = error.message;

  // Check for known error patterns
  for (const [pattern, friendlyMessage] of Object.entries(ERROR_MESSAGES)) {
    if (errorMessage.includes(pattern)) {
      return friendlyMessage;
    }
  }

  // Default message for unknown errors - don't expose technical details
  return 'Authentication failed. Please try again.';
}

/**
 * Get a sanitized error message for logging purposes.
 * Removes any potentially sensitive data like tokens.
 */
export function getSafeLogMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Unknown error type';
  }

  // Remove any token-like patterns from the message
  const sanitized = error.message
    .replace(/access_token=[^&\s]+/gi, 'access_token=[REDACTED]')
    .replace(/refresh_token=[^&\s]+/gi, 'refresh_token=[REDACTED]')
    .replace(/token=[^&\s]+/gi, 'token=[REDACTED]')
    .replace(/bearer\s+[^\s]+/gi, 'Bearer [REDACTED]');

  return sanitized;
}

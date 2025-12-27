/**
 * Username validation constants and utility.
 * These values must match the server-side validation in:
 * supabase/migrations/0032_add_username.sql
 */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;

// Only letters, numbers, and underscores allowed
export const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

export interface UsernameValidationResult {
  isValid: boolean;
  error?: string;
  value: string;
}

/**
 * Validates a username and returns the result.
 * @param username - The username to validate
 * @returns Validation result with isValid, optional error message, and cleaned value
 */
export function validateUsername(username: string): UsernameValidationResult {
  // Remove leading/trailing whitespace
  const value = username.trim();

  if (!value) {
    return { isValid: false, error: 'Please enter a username', value };
  }

  if (value.length < USERNAME_MIN_LENGTH) {
    return {
      isValid: false,
      error: `Username must be at least ${USERNAME_MIN_LENGTH} characters`,
      value,
    };
  }

  if (value.length > USERNAME_MAX_LENGTH) {
    return {
      isValid: false,
      error: `Username must be ${USERNAME_MAX_LENGTH} characters or less`,
      value,
    };
  }

  if (!USERNAME_PATTERN.test(value)) {
    return {
      isValid: false,
      error: 'Username can only contain letters, numbers, and underscores',
      value,
    };
  }

  return { isValid: true, value };
}

/**
 * Generates a suggested username from a display name.
 * @param displayName - The display name to convert
 * @returns A valid username base (may need uniqueness suffix on server)
 */
export function generateUsernameFromName(displayName: string): string {
  let username = displayName
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_') // Replace invalid chars with underscore
    .replace(/_+/g, '_') // Remove consecutive underscores
    .replace(/^_|_$/g, ''); // Remove leading/trailing underscores

  // Ensure minimum length
  if (username.length < USERNAME_MIN_LENGTH) {
    username = 'user_' + username;
  }

  // Truncate to max length
  if (username.length > USERNAME_MAX_LENGTH) {
    username = username.substring(0, USERNAME_MAX_LENGTH);
  }

  return username;
}

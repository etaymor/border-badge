/**
 * Shared display name validation constants and utility.
 * These values must match the server-side validation in:
 * supabase/migrations/0013_update_display_name_function.sql
 */

export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 50;

export interface DisplayNameValidationResult {
  isValid: boolean;
  error?: string;
  trimmedValue: string;
}

/**
 * Validates a display name and returns the result with trimmed value.
 * @param name - The display name to validate
 * @returns Validation result with isValid, optional error message, and trimmed value
 */
export function validateDisplayName(name: string): DisplayNameValidationResult {
  const trimmed = name.trim();

  if (!trimmed) {
    return { isValid: false, error: 'Please enter your name', trimmedValue: trimmed };
  }

  if (trimmed.length < DISPLAY_NAME_MIN_LENGTH) {
    return {
      isValid: false,
      error: `Name must be at least ${DISPLAY_NAME_MIN_LENGTH} characters`,
      trimmedValue: trimmed,
    };
  }

  if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
    return {
      isValid: false,
      error: `Name must be ${DISPLAY_NAME_MAX_LENGTH} characters or less`,
      trimmedValue: trimmed,
    };
  }

  return { isValid: true, trimmedValue: trimmed };
}

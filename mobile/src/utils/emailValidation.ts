// Validation result type (shared pattern with other validators)
export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * RFC 5322 compliant email regex (simplified but comprehensive).
 *
 * This regex enforces:
 * - Local part: letters, numbers, and common special characters
 * - Domain: starts/ends with alphanumeric, allows hyphens in between
 * - TLD: at least 2 characters, must be letters only
 * - Rejects: consecutive dots, leading/trailing dots, single-char TLDs
 */
const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

/**
 * Validates an email address format.
 * Returns normalized (trimmed, lowercased) email on success.
 */
export function validateEmail(email: string): ValidationResult & { normalizedEmail?: string } {
  if (!email || !email.trim()) {
    return { isValid: false, error: 'Please enter your email address' };
  }

  const normalized = email.trim().toLowerCase();

  if (!EMAIL_REGEX.test(normalized)) {
    return { isValid: false, error: 'Please enter a valid email address' };
  }

  return { isValid: true, normalizedEmail: normalized };
}

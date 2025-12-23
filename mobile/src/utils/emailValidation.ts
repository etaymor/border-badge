// Validation result type (shared pattern with other validators)
export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * RFC 5321 maximum email length (local-part@domain).
 * Local part: 64 chars max, domain: 255 chars max, total: 320 chars max
 */
const MAX_EMAIL_LENGTH = 320;

/**
 * RFC 5322 compliant email regex (simplified but comprehensive).
 *
 * This regex enforces:
 * - Local part: letters, numbers, and common special characters
 * - Domain: starts/ends with alphanumeric, allows hyphens in between
 * - TLD: at least 2 characters, must be letters only
 * - Rejects: leading/trailing dots, single-char TLDs
 *
 * Note: Consecutive dots are checked separately for better error messages.
 */
const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

/**
 * Pattern to detect consecutive dots in the local part (before @).
 * RFC 5321 does not allow consecutive dots in unquoted local parts.
 */
const CONSECUTIVE_DOTS_REGEX = /\.{2,}/;

/**
 * Validates an email address format.
 * Returns normalized (trimmed, lowercased) email on success.
 *
 * Checks include:
 * - Required field validation
 * - Maximum length (RFC 5321: 320 chars)
 * - Consecutive dots in local part
 * - RFC 5322 format compliance
 */
export function validateEmail(email: string): ValidationResult & { normalizedEmail?: string } {
  if (!email || !email.trim()) {
    return { isValid: false, error: 'Please enter your email address' };
  }

  const normalized = email.trim().toLowerCase();

  // Check maximum length per RFC 5321
  if (normalized.length > MAX_EMAIL_LENGTH) {
    return { isValid: false, error: 'Email address is too long' };
  }

  // Check for consecutive dots in local part (before @)
  const localPart = normalized.split('@')[0];
  if (localPart && CONSECUTIVE_DOTS_REGEX.test(localPart)) {
    return { isValid: false, error: 'Please enter a valid email address' };
  }

  if (!EMAIL_REGEX.test(normalized)) {
    return { isValid: false, error: 'Please enter a valid email address' };
  }

  return { isValid: true, normalizedEmail: normalized };
}

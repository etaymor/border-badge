import { isValidPhoneNumber } from 'libphonenumber-js';

// Constants
export const OTP_LENGTH = 6;
export const RESEND_COOLDOWN_SECONDS = 60;

// Dev-only: Allow 555 area code for local testing
// 555-0100 through 555-0199 are reserved for fictional use
const DEV_PHONE_REGEX = /^\+1555\d{7}$/;

// Validation result type
export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validates a phone number using libphonenumber-js.
 * Expects E.164 format (e.g., +14155552671)
 * In development, also allows 555 area code numbers for testing.
 */
export function validatePhone(phone: string): ValidationResult {
  if (!phone) {
    return { isValid: false, error: 'Please enter your phone number' };
  }

  // Allow 555 numbers in development for testing
  if (__DEV__ && DEV_PHONE_REGEX.test(phone)) {
    return { isValid: true };
  }

  if (!isValidPhoneNumber(phone)) {
    return { isValid: false, error: 'Please enter a valid phone number' };
  }

  return { isValid: true };
}

// Regex for exactly 6 digits
const OTP_REGEX = /^\d{6}$/;

/**
 * Validates an OTP code.
 * Ensures the code is exactly 6 digits (not just 6 characters).
 */
export function validateOTP(otp: string): ValidationResult {
  if (!OTP_REGEX.test(otp)) {
    return { isValid: false, error: `Please enter the ${OTP_LENGTH}-digit code` };
  }
  return { isValid: true };
}

/**
 * Formats a phone number for display.
 * Shows the full number so users can verify they entered correctly.
 * Example: +14155552671 → +1 415 555 2671
 */
export function formatPhoneForDisplay(phone: string): string {
  if (!phone || phone.length < 4) return phone;

  // Remove + prefix for processing
  const digits = phone.replace(/^\+/, '');

  // Format based on length (assuming E.164 format)
  if (digits.length === 11 && digits.startsWith('1')) {
    // US/Canada: +1 XXX XXX XXXX
    return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  } else if (digits.length >= 10) {
    // International: +XX XXX XXX XXXX (rough grouping)
    const countryCode = digits.slice(0, digits.length - 10);
    const rest = digits.slice(-10);
    return `+${countryCode} ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`;
  }

  // Fallback: just add spaces every 3-4 digits
  return `+${digits.replace(/(\d{3})(?=\d)/g, '$1 ')}`;
}

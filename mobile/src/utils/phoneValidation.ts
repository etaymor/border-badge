import { isValidPhoneNumber } from 'libphonenumber-js';

// Constants
export const OTP_LENGTH = 6;
export const RESEND_COOLDOWN_SECONDS = 60;

// Validation result type
export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validates a phone number using libphonenumber-js.
 * Expects E.164 format (e.g., +14155552671)
 */
export function validatePhone(phone: string): ValidationResult {
  if (!phone) {
    return { isValid: false, error: 'Please enter your phone number' };
  }

  if (!isValidPhoneNumber(phone)) {
    return { isValid: false, error: 'Please enter a valid phone number' };
  }

  return { isValid: true };
}

/**
 * Validates an OTP code.
 */
export function validateOTP(otp: string): ValidationResult {
  if (otp.length !== OTP_LENGTH) {
    return { isValid: false, error: `Please enter the ${OTP_LENGTH}-digit code` };
  }
  return { isValid: true };
}

/**
 * Formats a phone number for display by masking all but the last 4 digits.
 * Example: +14155552671 → ********2671
 */
export function formatPhoneForDisplay(phone: string): string {
  if (phone.length <= 4) return phone;
  return `${phone.slice(0, -4).replace(/./g, '*')}${phone.slice(-4)}`;
}

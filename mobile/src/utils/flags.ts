/**
 * Utility functions for country flag display.
 */

/**
 * Special flag mappings for non-standard country codes.
 * These codes don't have standard Unicode regional indicator flags.
 */
const SPECIAL_FLAGS: Record<string, string> = {
  // UK constituent countries (use subdivision flags)
  XS: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}', // Scotland
  XW: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}', // Wales
  XI: '\u{1F1EC}\u{1F1E7}', // Northern Ireland (no subdivision flag, use UK)

  // Special regions without standard flags
  ZZ: '\u{1F1F9}\u{1F1FF}', // Zanzibar (use Tanzania)
  XN: '\u{1F1E8}\u{1F1FE}', // Northern Cyprus (use Cyprus as fallback)
};

/**
 * Convert a 2-letter country code to its flag emoji.
 * Uses Unicode regional indicator symbols for standard codes,
 * with special handling for constituent countries and territories.
 *
 * @example getFlagEmoji('US') returns '🇺🇸'
 * @example getFlagEmoji('XS') returns Scotland flag
 */
export function getFlagEmoji(countryCode: string): string {
  const code = countryCode.toUpperCase();

  // Check for special flags first
  if (SPECIAL_FLAGS[code]) {
    return SPECIAL_FLAGS[code];
  }

  // Standard regional indicator conversion
  const codePoints = code.split('').map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

/**
 * Utility functions for country flag display.
 */

/**
 * Convert a 2-letter country code to its flag emoji.
 * Uses Unicode regional indicator symbols.
 *
 * @example getFlagEmoji('US') returns '🇺🇸'
 */
export function getFlagEmoji(countryCode: string): string {
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

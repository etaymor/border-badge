/**
 * URL utilities for public share links.
 */

/**
 * Get base URL for public web pages.
 * Returns empty string if not configured.
 */
function getWebBaseUrl(): string {
  const baseUrl = process.env.EXPO_PUBLIC_WEB_BASE_URL ?? '';
  return baseUrl.replace(/\/+$/, ''); // Remove trailing slashes
}

/**
 * Get public share URL for a user profile.
 * @param username - The username to link to
 * @returns Full URL to the public profile page, or empty string if not configured
 */
export function getPublicProfileUrl(username: string): string {
  const baseUrl = getWebBaseUrl();
  if (!baseUrl || !username) {
    return '';
  }
  return `${baseUrl}/u/${username}`;
}

/**
 * Get public share URL for a list.
 * @param slug - The list's share slug
 * @returns Full URL to the public list page, or empty string if not configured
 */
export function getPublicListUrl(slug: string): string {
  const baseUrl = getWebBaseUrl();
  if (!baseUrl || !slug) {
    return '';
  }
  return `${baseUrl}/l/${slug}`;
}

/**
 * Get public share URL for a trip.
 * @param shareSlug - The trip's share slug
 * @returns Full URL to the public trip page, or empty string if not configured
 */
export function getPublicTripUrl(shareSlug: string): string {
  const baseUrl = getWebBaseUrl();
  if (!baseUrl || !shareSlug) {
    return '';
  }
  return `${baseUrl}/t/${shareSlug}`;
}

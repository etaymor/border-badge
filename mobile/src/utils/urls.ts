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
 * Append the share-attribution referrer (?ref=<username>) to a share URL.
 * Public pages parse and log this for share attribution.
 */
function appendRef(url: string, ref?: string): string {
  if (!url || !ref) {
    return url;
  }
  const parsed = new URL(url);
  parsed.searchParams.set('ref', ref);
  return parsed.toString();
}

/**
 * Get public share URL for a user profile.
 * @param username - The username to link to
 * @param ref - Optional sharing user's username for attribution
 * @returns Full URL to the public profile page, or empty string if not configured
 */
export function getPublicProfileUrl(username: string, ref?: string): string {
  const baseUrl = getWebBaseUrl();
  if (!baseUrl || !username) {
    return '';
  }
  return appendRef(`${baseUrl}/u/${username}`, ref);
}

/**
 * Get public share URL for a list.
 * @param slug - The list's share slug
 * @param ref - Optional sharing user's username for attribution
 * @returns Full URL to the public list page, or empty string if not configured
 */
export function getPublicListUrl(slug: string, ref?: string): string {
  const baseUrl = getWebBaseUrl();
  if (!baseUrl || !slug) {
    return '';
  }
  return appendRef(`${baseUrl}/l/${slug}`, ref);
}

/**
 * Get public share URL for a trip.
 * @param shareSlug - The trip's share slug
 * @param ref - Optional sharing user's username for attribution
 * @returns Full URL to the public trip page, or empty string if not configured
 */
export function getPublicTripUrl(shareSlug: string, ref?: string): string {
  const baseUrl = getWebBaseUrl();
  if (!baseUrl || !shareSlug) {
    return '';
  }
  return appendRef(`${baseUrl}/t/${shareSlug}`, ref);
}

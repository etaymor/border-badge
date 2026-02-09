/** Shared country-name resolution using the Intl.DisplayNames API. */

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

/** Resolve an ISO 3166-1 alpha-2 country code to its English display name. */
export function getCountryName(code: string): string {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

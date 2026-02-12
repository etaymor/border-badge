/** Shared country-name resolution using Intl.DisplayNames when available. */

type RegionNamesApi = { of: (code: string) => string | undefined };

const regionNames: RegionNamesApi | null = (() => {
  try {
    if (
      typeof Intl !== 'undefined' &&
      typeof (Intl as typeof Intl & { DisplayNames?: unknown }).DisplayNames === 'function'
    ) {
      const DisplayNamesCtor = (Intl as typeof Intl & {
        DisplayNames: new (
          locales?: string | string[],
          options?: { type: 'language' | 'region' | 'script' | 'currency' }
        ) => RegionNamesApi;
      }).DisplayNames;
      return new DisplayNamesCtor(['en'], { type: 'region' });
    }
  } catch {
    // Fall back to returning the original country code.
  }

  return null;
})();

/** Resolve an ISO 3166-1 alpha-2 country code to its English display name. */
export function getCountryName(code: string): string {
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Deep-link / universal-link configuration.
 *
 * Ownership split:
 * - React Navigation `linking` owns navigable content links: /u/:username,
 *   /t/:slug, /l/:slug (universal links) and atlasi://country/:countryId.
 * - Manual handlers in App.tsx keep EXCLUSIVE ownership of share-extension
 *   URLs (atlasi://share, https://<domain>/share) and invite links
 *   (/invite?code=...). Auth callbacks (atlasi://auth-callback) are consumed
 *   by WebBrowser.openAuthSessionAsync in the OAuth hooks and must never
 *   reach navigation either. The `filter` below enforces this split so a
 *   single URL is never double-handled.
 */

import type { LinkingOptions } from '@react-navigation/native';

import { env } from '@config/env';
import { features } from '@config/features';
import type { RootStackParamList } from './types';

/**
 * Production web origin — matches the associated domain (applinks:atlasi.app).
 * Deliberately not `env.webBaseUrl`: universal links must recognize the
 * production origin in every build environment, while `webBaseUrl` points at
 * a local/dev server outside production.
 */
export const PRODUCTION_WEB_ORIGIN = 'https://atlasi.app';

/**
 * Extract a normalized path (no leading slash, no query/fragment) from a
 * deep-link URL. For the custom scheme the "host" is the path head
 * (atlasi://share?url=x -> "share"); for http(s) the host is dropped
 * (https://atlasi.app/u/alex -> "u/alex").
 *
 * Hand-rolled on purpose: custom-scheme URLs parse differently under the
 * WHATWG URL class (host vs. path), so do not rewrite this with `new URL`.
 */
export function getDeepLinkPath(url: string): string {
  const schemeMatch = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  if (!schemeMatch) {
    return url.replace(/^\/+/, '').split(/[?#]/)[0];
  }

  const scheme = schemeMatch[1].toLowerCase();
  const rest = url.slice(schemeMatch[0].length).split(/[?#]/)[0];

  if (scheme === 'http' || scheme === 'https') {
    const slashIndex = rest.indexOf('/');
    return slashIndex === -1 ? '' : rest.slice(slashIndex + 1).replace(/^\/+/, '');
  }

  // Custom scheme: host + path together form the logical path.
  return rest.replace(/^\/+/, '');
}

/** True for OAuth callback URLs (owned by WebBrowser.openAuthSessionAsync). */
export function isAuthCallbackUrl(url: string): boolean {
  const path = getDeepLinkPath(url);
  return path === 'auth-callback' || path.startsWith('auth-callback/');
}

/** True for share-extension URLs (owned by useShareExtensionHandler). */
export function isShareExtensionUrl(url: string): boolean {
  const path = getDeepLinkPath(url);
  return path === 'share' || path.startsWith('share/');
}

/** True for invite landing links (owned by useInviteLinkHandler). */
export function isInviteUrl(url: string): boolean {
  const path = getDeepLinkPath(url);
  return path === 'invite' || path.startsWith('invite/');
}

/** Extract the ?code= value from an invite link, or null. */
export function getInviteCodeFromUrl(url: string): string | null {
  if (!isInviteUrl(url)) {
    return null;
  }
  try {
    return new URL(url).searchParams.get('code');
  } catch {
    return null;
  }
}

/**
 * React Navigation linking filter: keep the manual handlers' URLs out of
 * navigation so they are handled exactly once.
 */
export function shouldHandleUrlWithNavigation(url: string): boolean {
  return !isAuthCallbackUrl(url) && !isShareExtensionUrl(url) && !isInviteUrl(url);
}

function buildPrefixes(): string[] {
  const webBase = env.webBaseUrl.replace(/\/+$/, '');
  return Array.from(new Set(['atlasi://', PRODUCTION_WEB_ORIGIN, webBase]));
}

/**
 * Deep linking configuration for the app.
 * Handles atlasi:// URLs (Share Extension, country shortcuts) and https
 * universal links for shared content (/u, /t, /l).
 */
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: buildPrefixes(),
  filter: shouldHandleUrlWithNavigation,
  config: {
    screens: {
      Main: {
        screens: {
          Passport: {
            screens: {
              // Kept for completeness; share URLs are filtered out above and
              // handled manually by useShareExtensionHandler.
              ShareCapture: {
                path: 'share',
                parse: {
                  url: (value: string) => decodeURIComponent(value),
                },
              },
              CountryDetail: 'country/:countryId',
            },
          },
          // /u/:username opens the traveler's in-app profile. Only mapped
          // when the Friends tab exists (social feature flag).
          ...(features.enableSocial
            ? {
                Friends: {
                  screens: {
                    UserProfile: 'u/:username',
                  },
                },
              }
            : {}),
          // Shared trip/list slugs are web share slugs with no in-app
          // resolver (public pages are the canonical render); the app opens
          // on the Trips surface instead of dead-ending.
          Trips: {
            screens: {
              TripsList: {
                path: 't/:slug',
                alias: ['l/:slug'],
              },
            },
          },
        },
      },
    },
  },
};

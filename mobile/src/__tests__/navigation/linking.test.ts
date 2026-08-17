/**
 * Tests for the deep-link / universal-link configuration (U7).
 *
 * Covers:
 * - getStateFromPath resolution: /u/:username, /t/:slug, /l/:slug
 * - The linking filter excluding auth-callback, share-extension, and invite
 *   URLs so the manual handlers keep exclusive ownership
 * - Invite code extraction from /invite?code= links
 */

// Social features on: the /u/:username mapping targets the Friends tab.
jest.mock('@config/features', () => ({
  features: { enableSocial: true },
}));

import {
  getStateFromPath,
  type NavigationState,
  type PartialState,
} from '@react-navigation/native';

import {
  linking,
  getDeepLinkPath,
  getInviteCodeFromUrl,
  shouldHandleUrlWithNavigation,
} from '@navigation/linking';

type State = PartialState<NavigationState> | NavigationState | undefined;

/** Walk to the deepest focused route of a navigation state. */
function getLeafRoute(state: State): { name: string; params?: object } | null {
  if (!state || !state.routes || state.routes.length === 0) return null;
  let route = state.routes[state.routes.length - 1];
  while (route.state && route.state.routes && route.state.routes.length > 0) {
    route = route.state.routes[route.state.routes.length - 1] as typeof route;
  }
  return route;
}

describe('linking config (getStateFromPath)', () => {
  it('resolves /u/:username to the UserProfile screen', () => {
    const state = getStateFromPath('/u/alex', linking.config);
    const leaf = getLeafRoute(state);
    expect(leaf?.name).toBe('UserProfile');
    expect(leaf?.params).toMatchObject({ username: 'alex' });
  });

  it('resolves /t/:slug to the Trips surface', () => {
    const state = getStateFromPath('/t/summer-vacation-abc123', linking.config);
    const leaf = getLeafRoute(state);
    expect(leaf?.name).toBe('TripsList');
    expect(leaf?.params).toMatchObject({ slug: 'summer-vacation-abc123' });
  });

  it('resolves /l/:slug to the Trips surface', () => {
    const state = getStateFromPath('/l/tokyo-eats-xyz', linking.config);
    const leaf = getLeafRoute(state);
    expect(leaf?.name).toBe('TripsList');
    expect(leaf?.params).toMatchObject({ slug: 'tokyo-eats-xyz' });
  });

  it('still resolves the country shortcut used by in-app deep links', () => {
    const state = getStateFromPath('/country/JP', linking.config);
    const leaf = getLeafRoute(state);
    expect(leaf?.name).toBe('CountryDetail');
    expect(leaf?.params).toMatchObject({ countryId: 'JP' });
  });

  it('includes the production web origin and custom scheme as prefixes', () => {
    expect(linking.prefixes).toEqual(expect.arrayContaining(['atlasi://', 'https://atlasi.app']));
  });
});

describe('linking filter (manual-handler exclusivity)', () => {
  it.each([
    'atlasi://auth-callback',
    'atlasi://auth-callback?code=abc',
    'atlasi://share?url=https%3A%2F%2Fexample.com',
    'https://atlasi.app/share?url=https%3A%2F%2Fexample.com',
    'https://atlasi.app/invite?code=xyz',
    'atlasi://invite?code=xyz',
  ])('excludes %s from React Navigation handling', (url) => {
    expect(shouldHandleUrlWithNavigation(url)).toBe(false);
    expect(linking.filter?.(url)).toBe(false);
  });

  it.each([
    'https://atlasi.app/u/alex',
    'https://atlasi.app/t/summer-vacation-abc123',
    'https://atlasi.app/l/tokyo-eats-xyz',
    'atlasi://country/JP',
  ])('allows %s through to React Navigation', (url) => {
    expect(shouldHandleUrlWithNavigation(url)).toBe(true);
    expect(linking.filter?.(url)).toBe(true);
  });
});

describe('getDeepLinkPath', () => {
  it.each([
    ['https://atlasi.app/u/alex?ref=bob', 'u/alex'],
    ['https://atlasi.app/invite?code=x', 'invite'],
    ['atlasi://share?url=x', 'share'],
    ['atlasi://auth-callback#access_token=x', 'auth-callback'],
    ['https://atlasi.app', ''],
    ['https://atlasi.app/', ''],
  ])('normalizes %s to %s', (url, expected) => {
    expect(getDeepLinkPath(url)).toBe(expected);
  });
});

describe('getInviteCodeFromUrl', () => {
  it('extracts the code from a web invite link', () => {
    expect(getInviteCodeFromUrl('https://atlasi.app/invite?code=abc123')).toBe('abc123');
  });

  it('decodes percent-encoded codes', () => {
    expect(getInviteCodeFromUrl('https://atlasi.app/invite?code=a%3Db%26c')).toBe('a=b&c');
  });

  it('reads the code among other params (e.g. ref)', () => {
    expect(getInviteCodeFromUrl('https://atlasi.app/invite?ref=alex&code=zzz')).toBe('zzz');
  });

  it('returns null for invite links without a code', () => {
    expect(getInviteCodeFromUrl('https://atlasi.app/invite')).toBeNull();
  });

  it('returns null for non-invite links', () => {
    expect(getInviteCodeFromUrl('https://atlasi.app/u/alex?code=zzz')).toBeNull();
  });
});

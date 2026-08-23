/**
 * Tests for jobGates - the preconditions checked before a suspended job resumes.
 *
 * The defer-vs-fail distinction is the point of most of these: treating an
 * unhydrated store as a failure would clear a perfectly good breadcrumb on
 * every cold start.
 */

import {
  authSessionGate,
  homeCountryGate,
  mediaLibraryPermissionGate,
  subscriptionGate,
} from '@services/jobs/jobGates';
import { useAuthStore } from '@stores/authStore';
import { useOnboardingStore } from '@stores/onboardingStore';
import { useSubscriptionStore } from '@stores/subscriptionStore';

jest.mock('expo-media-library', () => ({
  getPermissionsAsync: jest.fn(),
}));

const MediaLibrary = jest.requireMock('expo-media-library');

const RECORD = { startedAt: Date.now() };

beforeEach(() => {
  jest.clearAllMocks();
  MediaLibrary.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
});

describe('mediaLibraryPermissionGate', () => {
  it('passes when access is granted', async () => {
    expect(await mediaLibraryPermissionGate.check('trip-scan', RECORD)).toEqual({ status: 'pass' });
  });

  it('fails when access was revoked while the app was away', async () => {
    MediaLibrary.getPermissionsAsync.mockResolvedValue({ status: 'denied' });
    const outcome = await mediaLibraryPermissionGate.check('trip-scan', RECORD);
    expect(outcome).toMatchObject({ status: 'fail', failure: { reason: 'no-permission' } });
  });
});

describe('homeCountryGate', () => {
  it('passes when a home country is set', async () => {
    useOnboardingStore.setState({ homeCountry: 'JP' });
    expect(await homeCountryGate.check('trip-scan', RECORD)).toEqual({ status: 'pass' });
  });

  it('DEFERS rather than failing when the onboarding store has not hydrated', async () => {
    useOnboardingStore.setState({ homeCountry: null });
    const spy = jest.spyOn(useOnboardingStore.persist, 'hasHydrated').mockReturnValue(false);

    const outcome = await homeCountryGate.check('trip-scan', RECORD);
    expect(outcome).toMatchObject({ status: 'defer' });
    spy.mockRestore();
  });

  it('fails once hydrated with no home country', async () => {
    useOnboardingStore.setState({ homeCountry: null });
    const spy = jest.spyOn(useOnboardingStore.persist, 'hasHydrated').mockReturnValue(true);

    const outcome = await homeCountryGate.check('trip-scan', RECORD);
    expect(outcome).toMatchObject({ status: 'fail', failure: { reason: 'home-country' } });
    spy.mockRestore();
  });
});

describe('subscriptionGate', () => {
  it('DEFERS before rehydration so a stale free default cannot trip it', async () => {
    const spy = jest.spyOn(useSubscriptionStore.persist, 'hasHydrated').mockReturnValue(false);
    expect(await subscriptionGate.check('trip-scan', RECORD)).toMatchObject({ status: 'defer' });
    spy.mockRestore();
  });

  it('passes for a premium subscriber', async () => {
    const spy = jest.spyOn(useSubscriptionStore.persist, 'hasHydrated').mockReturnValue(true);
    useSubscriptionStore.setState({ status: 'premium', photoImportUsage: 99 });
    expect(await subscriptionGate.check('trip-scan', RECORD)).toEqual({ status: 'pass' });
    spy.mockRestore();
  });

  it('fails a free user who has exhausted the photo-import allowance', async () => {
    const spy = jest.spyOn(useSubscriptionStore.persist, 'hasHydrated').mockReturnValue(true);
    useSubscriptionStore.setState({ status: 'free', photoImportUsage: 99 });
    const outcome = await subscriptionGate.check('trip-scan', RECORD);
    expect(outcome).toMatchObject({ status: 'fail', failure: { reason: 'subscription-expired' } });
    spy.mockRestore();
  });
});

describe('authSessionGate', () => {
  it('DEFERS while the initial Supabase getSession is still resolving', async () => {
    useAuthStore.setState({ isLoading: true, session: null });
    expect(await authSessionGate.check('quiz-build', RECORD)).toMatchObject({ status: 'defer' });
  });

  it('passes with a session', async () => {
    useAuthStore.setState({
      isLoading: false,
      session: { access_token: 't' } as never,
    });
    expect(await authSessionGate.check('quiz-build', RECORD)).toEqual({ status: 'pass' });
  });

  it('fails when resolved with no session', async () => {
    useAuthStore.setState({ isLoading: false, session: null });
    const outcome = await authSessionGate.check('quiz-build', RECORD);
    expect(outcome).toMatchObject({ status: 'fail', failure: { reason: 'signed-out' } });
  });
});

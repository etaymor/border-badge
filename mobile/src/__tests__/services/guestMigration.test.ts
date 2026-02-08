/**
 * Tests for guest migration service.
 * Focuses on ensuring home_country_code is correctly sent during profile migration.
 *
 * Bug: home_country_code was not being saved to user_profile during onboarding
 * because the Zustand store's homeCountry field could be null by the time
 * doMigration() reads it (due to persist middleware rehydration race).
 * Fix: Callers now capture a snapshot before setSession() and pass it explicitly.
 */

import type { Session } from '@supabase/supabase-js';

import { api } from '@services/api';
import { getHomeCountry } from '@services/countriesDb';
import { useOnboardingStore } from '@stores/onboardingStore';
import {
  migrateGuestData,
  captureOnboardingSnapshot,
  type OnboardingSnapshot,
} from '@services/guestMigration';

// Mock API module
jest.mock('@services/api', () => ({
  api: {
    post: jest.fn().mockResolvedValue({ data: [] }),
    patch: jest.fn().mockResolvedValue({ data: [{ id: 'profile-1' }] }),
    defaults: { baseURL: 'http://localhost:8000' },
  },
  getStoredToken: jest.fn().mockResolvedValue('mock-token'),
  setSuppressAutoSignOut: jest.fn(),
}));

// Mock queryClient
jest.mock('../../queryClient', () => ({
  queryClient: {
    invalidateQueries: jest.fn().mockResolvedValue(undefined),
    setQueryData: jest.fn(),
  },
}));

// Mock countriesDb
jest.mock('@services/countriesDb', () => ({
  getLocalUserCountries: jest.fn().mockResolvedValue([]),
  clearLocalUserCountries: jest.fn().mockResolvedValue(undefined),
  saveLocalUserCountry: jest.fn().mockResolvedValue(undefined),
  removeLocalUserCountry: jest.fn().mockResolvedValue(undefined),
  getHomeCountry: jest.fn().mockResolvedValue(null),
  clearHomeCountry: jest.fn().mockResolvedValue(undefined),
  saveHomeCountry: jest.fn().mockResolvedValue(undefined),
}));

const mockedApiPost = api.post as jest.MockedFunction<typeof api.post>;
const mockedApiPatch = api.patch as jest.MockedFunction<typeof api.patch>;

// Create a minimal mock session
function createMockSession(): Session {
  return {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Date.now() / 1000 + 3600,
    user: {
      id: 'user-123',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'test@example.com',
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  } as Session;
}

describe('guestMigration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset onboarding store to defaults
    useOnboardingStore.getState().reset();
    // Suppress console output in tests
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('captureOnboardingSnapshot', () => {
    it('captures homeCountry from the store', () => {
      useOnboardingStore.setState({ homeCountry: 'US' });
      const snapshot = captureOnboardingSnapshot();
      expect(snapshot.homeCountry).toBe('US');
    });

    it('captures all fields from the store', () => {
      useOnboardingStore.setState({
        homeCountry: 'DE',
        selectedCountries: ['DE', 'FR'],
        bucketListCountries: ['JP'],
        dreamDestination: 'JP',
        motivationTags: ['Adventure'],
        personaTags: ['Explorer'],
        trackingPreference: 'full_atlas',
      });

      const snapshot = captureOnboardingSnapshot();

      expect(snapshot).toEqual({
        homeCountry: 'DE',
        selectedCountries: ['DE', 'FR'],
        bucketListCountries: ['JP'],
        dreamDestination: 'JP',
        motivationTags: ['Adventure'],
        personaTags: ['Explorer'],
        trackingPreference: 'full_atlas',
      });
    });

    it('returns defensive copies of arrays', () => {
      useOnboardingStore.setState({
        selectedCountries: ['US'],
        motivationTags: ['Food'],
      });

      const snapshot = captureOnboardingSnapshot();
      // Mutating snapshot should not affect store
      snapshot.selectedCountries.push('FR');
      snapshot.motivationTags.push('Culture');

      const storeState = useOnboardingStore.getState();
      expect(storeState.selectedCountries).toEqual(['US']);
      expect(storeState.motivationTags).toEqual(['Food']);
    });
  });

  describe('migrateGuestData - home_country_code bug', () => {
    it('sends home_country_code in PATCH /profile when homeCountry is set', async () => {
      const session = createMockSession();
      const snapshot: OnboardingSnapshot = {
        selectedCountries: ['US'],
        bucketListCountries: [],
        dreamDestination: null,
        homeCountry: 'US',
        motivationTags: ['Adventure'],
        personaTags: ['Explorer'],
        trackingPreference: 'full_atlas',
      };

      await migrateGuestData(session, snapshot);

      // Find the PATCH /profile call
      const patchCalls = mockedApiPatch.mock.calls;
      const profilePatchCall = patchCalls.find((call) => call[0] === '/profile');

      expect(profilePatchCall).toBeDefined();
      expect(profilePatchCall![1]).toMatchObject({
        home_country_code: 'US',
      });
    });

    it('does NOT send home_country_code as null in PATCH payload', async () => {
      const session = createMockSession();
      const snapshot: OnboardingSnapshot = {
        selectedCountries: ['FR'],
        bucketListCountries: [],
        dreamDestination: null,
        homeCountry: null,
        motivationTags: ['Food'],
        personaTags: [],
        trackingPreference: 'full_atlas',
      };

      await migrateGuestData(session, snapshot);

      // Find the PATCH /profile call
      const patchCalls = mockedApiPatch.mock.calls;
      const profilePatchCall = patchCalls.find((call) => call[0] === '/profile');

      // When homeCountry is null, it should NOT be included in the payload
      // to avoid overwriting an existing value with null
      if (profilePatchCall) {
        expect(profilePatchCall[1]).not.toHaveProperty('home_country_code');
      }
    });

    it('uses snapshot values instead of reading store during migration', async () => {
      const session = createMockSession();

      // Set store to have a home country
      useOnboardingStore.setState({ homeCountry: 'US' });

      // But pass a snapshot with a DIFFERENT home country
      const snapshot: OnboardingSnapshot = {
        selectedCountries: ['DE'],
        bucketListCountries: [],
        dreamDestination: null,
        homeCountry: 'DE',
        motivationTags: [],
        personaTags: [],
        trackingPreference: 'full_atlas',
      };

      await migrateGuestData(session, snapshot);

      // The PATCH should use the snapshot's homeCountry (DE), not the store's (US)
      const patchCalls = mockedApiPatch.mock.calls;
      const profilePatchCall = patchCalls.find((call) => call[0] === '/profile');

      expect(profilePatchCall).toBeDefined();
      expect(profilePatchCall![1]).toMatchObject({
        home_country_code: 'DE',
      });
    });

    it('reproduces the original bug: store homeCountry null but snapshot has value', async () => {
      const session = createMockSession();

      // Simulate the race condition: store homeCountry is null (after rehydration)
      useOnboardingStore.setState({ homeCountry: null });

      // But snapshot was captured BEFORE the race, so it has the correct value
      const snapshot: OnboardingSnapshot = {
        selectedCountries: ['GB'],
        bucketListCountries: [],
        dreamDestination: null,
        homeCountry: 'GB',
        motivationTags: ['Culture'],
        personaTags: ['Historian'],
        trackingPreference: 'full_atlas',
      };

      await migrateGuestData(session, snapshot);

      // Should use snapshot value, NOT the store's null
      const patchCalls = mockedApiPatch.mock.calls;
      const profilePatchCall = patchCalls.find((call) => call[0] === '/profile');

      expect(profilePatchCall).toBeDefined();
      expect(profilePatchCall![1]).toMatchObject({
        home_country_code: 'GB',
        travel_motives: ['Culture'],
        persona_tags: ['Historian'],
      });
    });
  });

  describe('migrateGuestData - country migration', () => {
    it('includes homeCountry in visited countries batch', async () => {
      const session = createMockSession();
      const snapshot: OnboardingSnapshot = {
        selectedCountries: ['FR'],
        bucketListCountries: [],
        dreamDestination: null,
        homeCountry: 'US',
        motivationTags: [],
        personaTags: [],
        trackingPreference: 'full_atlas',
      };

      await migrateGuestData(session, snapshot);

      // Find the POST /countries/user/batch call for visited countries
      const postCalls = mockedApiPost.mock.calls;
      const visitedBatchCall = postCalls.find(
        (call) =>
          call[0] === '/countries/user/batch' &&
          (call[1] as { countries: { status: string }[] }).countries[0]?.status === 'visited'
      );

      expect(visitedBatchCall).toBeDefined();
      const countryCodes = (
        visitedBatchCall![1] as { countries: { country_code: string }[] }
      ).countries.map((c) => c.country_code);
      expect(countryCodes).toContain('US');
      expect(countryCodes).toContain('FR');
    });
  });

  describe('migrateGuestData - SQLite homeCountry fallback', () => {
    it('recovers homeCountry from SQLite when snapshot has null', async () => {
      // Simulate: Zustand persist rehydration wiped homeCountry, but SQLite still has it
      (getHomeCountry as jest.Mock).mockResolvedValueOnce('US');

      const session = createMockSession();
      const snapshot: OnboardingSnapshot = {
        selectedCountries: ['FR', 'DE'],
        bucketListCountries: [],
        dreamDestination: null,
        homeCountry: null, // Lost due to Zustand persist rehydration race
        motivationTags: ['Adventure'],
        personaTags: [],
        trackingPreference: 'full_atlas',
      };

      await migrateGuestData(session, snapshot);

      // Should recover US from SQLite and include in profile PATCH
      const patchCalls = mockedApiPatch.mock.calls;
      const profilePatchCall = patchCalls.find((call) => call[0] === '/profile');

      expect(profilePatchCall).toBeDefined();
      expect(profilePatchCall![1]).toMatchObject({
        home_country_code: 'US',
      });

      // Should also include US in visited countries
      const postCalls = mockedApiPost.mock.calls;
      const visitedBatchCall = postCalls.find(
        (call) =>
          call[0] === '/countries/user/batch' &&
          (call[1] as { countries: { status: string }[] }).countries[0]?.status === 'visited'
      );

      expect(visitedBatchCall).toBeDefined();
      const countryCodes = (
        visitedBatchCall![1] as { countries: { country_code: string }[] }
      ).countries.map((c) => c.country_code);
      expect(countryCodes).toContain('US');
      expect(countryCodes).toContain('FR');
      expect(countryCodes).toContain('DE');
    });

    it('does not call SQLite fallback when snapshot has homeCountry', async () => {
      const session = createMockSession();
      const snapshot: OnboardingSnapshot = {
        selectedCountries: ['US'],
        bucketListCountries: [],
        dreamDestination: null,
        homeCountry: 'US', // Already present in snapshot
        motivationTags: [],
        personaTags: [],
        trackingPreference: 'full_atlas',
      };

      await migrateGuestData(session, snapshot);

      // getHomeCountry should NOT be called since snapshot already has the value
      expect(getHomeCountry).not.toHaveBeenCalled();
    });
  });
});

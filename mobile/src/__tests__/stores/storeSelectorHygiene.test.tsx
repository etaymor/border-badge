/**
 * Store subscription hygiene (U3) — render-count probes.
 *
 * These tests assert that components subscribing to a store via per-field
 * selectors do NOT re-render when an unrelated store field changes, and that
 * they still re-render (with the correct value) when the field they subscribe
 * to does change. This mirrors the selector patterns adopted by the onboarding
 * screens (grid, motivation, account-creation) and the app-wide files.
 */

import type { Session } from '@supabase/supabase-js';
import { renderHook, act } from '@testing-library/react-native';
import { useRef } from 'react';

import {
  useAuthStore,
  selectSession,
  selectHasCompletedOnboarding,
  selectIsLoading,
} from '@stores/authStore';
import {
  useOnboardingStore,
  selectSelectedCountries,
  selectBucketListCountries,
  selectMotivationTags,
  selectPersonaTags,
  selectDisplayName,
} from '@stores/onboardingStore';

function createMockSession(overrides: Partial<Session> = {}): Session {
  return {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: {
      id: 'user-123',
      email: 'test@example.com',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    },
    ...overrides,
  } as Session;
}

/**
 * Render a hook while tracking how many times it rendered. Returns the hook
 * result plus a live render-count getter.
 */
function renderWithCount<T>(hook: () => T) {
  const renderCount = { current: 0 };
  const wrapped = renderHook(() => {
    const ref = useRef(0);
    ref.current += 1;
    renderCount.current = ref.current;
    return hook();
  });
  return { ...wrapped, renderCount };
}

describe('U3 store subscription hygiene', () => {
  beforeEach(() => {
    useOnboardingStore.setState({
      motivationTags: [],
      selectedCountries: [],
      currentStep: 0,
      personaTags: [],
      homeCountry: null,
      dreamDestination: null,
      bucketListCountries: [],
      visitedContinents: [],
      displayName: null,
    });
    useAuthStore.setState({
      session: null,
      hasCompletedOnboarding: false,
      isLoading: true,
      isMigrating: false,
      needsPostSignupFlow: false,
    });
  });

  describe('ContinentCountryGridScreen selectors', () => {
    it('does not re-render when an unrelated onboarding field changes', () => {
      const { result, renderCount } = renderWithCount(() => ({
        selectedCountries: useOnboardingStore(selectSelectedCountries),
        bucketListCountries: useOnboardingStore(selectBucketListCountries),
      }));

      const initialRenders = renderCount.current;
      expect(result.current.selectedCountries).toEqual([]);

      // Mutate an unrelated field (motivationTags / displayName).
      act(() => {
        useOnboardingStore.getState().toggleMotivationTag('Adventure');
        useOnboardingStore.getState().setDisplayName('Ada');
      });

      expect(renderCount.current).toBe(initialRenders);
    });

    it('re-renders and reflects the new value when a subscribed field changes', () => {
      const { result, renderCount } = renderWithCount(() => ({
        selectedCountries: useOnboardingStore(selectSelectedCountries),
        bucketListCountries: useOnboardingStore(selectBucketListCountries),
      }));

      const before = renderCount.current;

      act(() => {
        useOnboardingStore.getState().toggleCountry('US');
      });

      expect(renderCount.current).toBeGreaterThan(before);
      expect(result.current.selectedCountries).toContain('US');
      // Bucket list slice stays referentially the same across the update.
      expect(result.current.bucketListCountries).toEqual([]);
    });

    it('keeps action references stable across unrelated updates', () => {
      const { result } = renderHook(() => useOnboardingStore((s) => s.toggleCountry));
      const firstRef = result.current;

      act(() => {
        useOnboardingStore.getState().setDisplayName('Grace');
      });

      expect(result.current).toBe(firstRef);
    });
  });

  describe('MotivationScreen selectors', () => {
    it('does not re-render when an unrelated onboarding field changes', () => {
      const { renderCount } = renderWithCount(() => ({
        motivationTags: useOnboardingStore(selectMotivationTags),
        personaTags: useOnboardingStore(selectPersonaTags),
      }));

      const initialRenders = renderCount.current;

      act(() => {
        useOnboardingStore.getState().toggleCountry('FR');
        useOnboardingStore.getState().setHomeCountry('FR');
      });

      expect(renderCount.current).toBe(initialRenders);
    });

    it('re-renders when a subscribed tag field changes', () => {
      const { result, renderCount } = renderWithCount(() =>
        useOnboardingStore(selectMotivationTags)
      );

      const before = renderCount.current;

      act(() => {
        useOnboardingStore.getState().toggleMotivationTag('Food');
      });

      expect(renderCount.current).toBeGreaterThan(before);
      expect(result.current).toContain('Food');
    });
  });

  describe('AccountCreationScreen selectors', () => {
    it('displayName selector does not re-render on unrelated onboarding change', () => {
      const { renderCount } = renderWithCount(() => useOnboardingStore(selectDisplayName));

      const initialRenders = renderCount.current;

      act(() => {
        useOnboardingStore.getState().toggleCountry('JP');
        useOnboardingStore.getState().toggleMotivationTag('Nature');
      });

      expect(renderCount.current).toBe(initialRenders);
    });

    it('auth session selector does not re-render on unrelated auth change', () => {
      const { renderCount } = renderWithCount(() => useAuthStore(selectSession));

      const initialRenders = renderCount.current;

      // Flip unrelated auth fields.
      act(() => {
        useAuthStore.getState().setIsLoading(false);
        useAuthStore.getState().setNeedsPostSignupFlow(true);
      });

      expect(renderCount.current).toBe(initialRenders);
    });

    it('auth session selector re-renders when the session changes', () => {
      const { result, renderCount } = renderWithCount(() => useAuthStore(selectSession));

      const before = renderCount.current;

      act(() => {
        useAuthStore.getState().setSession(createMockSession());
      });

      expect(renderCount.current).toBeGreaterThan(before);
      expect(result.current?.user.id).toBe('user-123');
    });
  });

  describe('RootNavigator auth selectors', () => {
    it('each field selector isolates re-renders to its own field', () => {
      const loadingProbe = renderWithCount(() => useAuthStore(selectIsLoading));
      const onboardingProbe = renderWithCount(() => useAuthStore(selectHasCompletedOnboarding));

      const loadingBefore = loadingProbe.renderCount.current;
      const onboardingBefore = onboardingProbe.renderCount.current;

      // Changing hasCompletedOnboarding must not re-render the isLoading subscriber.
      act(() => {
        useAuthStore.getState().setHasCompletedOnboarding(true);
      });

      expect(loadingProbe.renderCount.current).toBe(loadingBefore);
      expect(onboardingProbe.renderCount.current).toBeGreaterThan(onboardingBefore);
    });
  });
});

import type { NavigationState } from '@react-navigation/native';

import {
  NAVIGATION_STATE_TTL_MS,
  NAVIGATION_STATE_VERSION,
  SENSITIVE_SCREENS,
  sanitizeNavigationState,
  isValidNavigationState,
  validatePersistedState,
  type PersistedNavigationState,
} from '@utils/navigationPersistence';

// Helper to create a valid route
const createRoute = (
  name: string,
  params?: Record<string, unknown>,
  state?: NavigationState
): NavigationState['routes'][number] => ({
  key: `${name}-key`,
  name,
  ...(params && { params }),
  ...(state && { state }),
});

// Helper to create a valid navigation state
const createNavigationState = (
  routes: NavigationState['routes'],
  index?: number
): NavigationState => ({
  routes,
  index: index ?? routes.length - 1,
  key: 'root-key',
  routeNames: routes.map((r) => r.name),
  type: 'stack',
  stale: false,
});

describe('navigationPersistence', () => {
  describe('constants', () => {
    it('has a 24-hour TTL', () => {
      const twentyFourHoursMs = 24 * 60 * 60 * 1000;
      expect(NAVIGATION_STATE_TTL_MS).toBe(twentyFourHoursMs);
    });

    it('includes ShareCapture in sensitive screens', () => {
      expect(SENSITIVE_SCREENS).toContain('ShareCapture');
    });

    it('has version 1 as current version', () => {
      expect(NAVIGATION_STATE_VERSION).toBe(1);
    });
  });

  describe('sanitizeNavigationState', () => {
    it('strips params from ShareCapture screen', () => {
      const state = createNavigationState([
        createRoute('ShareCapture', { url: 'https://secret.com', caption: 'my caption' }),
      ]);

      const result = sanitizeNavigationState(state);

      expect(result.routes[0].params).toBeUndefined();
      expect(result.routes[0].name).toBe('ShareCapture');
    });

    it('preserves params for non-sensitive screens', () => {
      const params = { countryId: 'US', tripId: '123' };
      const state = createNavigationState([createRoute('CountryDetail', params)]);

      const result = sanitizeNavigationState(state);

      expect(result.routes[0].params).toEqual(params);
    });

    it('handles multiple routes with mixed sensitivity', () => {
      const state = createNavigationState([
        createRoute('PassportHome'),
        createRoute('CountryDetail', { countryId: 'FR' }),
        createRoute('ShareCapture', { url: 'https://secret.com' }),
      ]);

      const result = sanitizeNavigationState(state);

      expect(result.routes[0].params).toBeUndefined();
      expect(result.routes[1].params).toEqual({ countryId: 'FR' });
      expect(result.routes[2].params).toBeUndefined();
    });

    it('recursively sanitizes nested navigation state', () => {
      const nestedState = createNavigationState([
        createRoute('ShareCapture', { url: 'https://nested-secret.com' }),
      ]);
      const state = createNavigationState([createRoute('Main', { screen: 'test' }, nestedState)]);

      const result = sanitizeNavigationState(state);

      // Nested ShareCapture params should be stripped
      const nestedRoutes = (result.routes[0].state as NavigationState).routes;
      expect(nestedRoutes[0].params).toBeUndefined();
    });

    it('handles deeply nested navigation states', () => {
      const level3 = createNavigationState([
        createRoute('ShareCapture', { url: 'https://deep-secret.com' }),
      ]);
      const level2 = createNavigationState([createRoute('InnerStack', {}, level3)]);
      const level1 = createNavigationState([createRoute('OuterStack', {}, level2)]);

      const result = sanitizeNavigationState(level1);

      // Navigate through the nested structure
      const l2State = result.routes[0].state as NavigationState;
      const l3State = l2State.routes[0].state as NavigationState;
      expect(l3State.routes[0].params).toBeUndefined();
    });

    it('preserves other state properties', () => {
      const state = createNavigationState([createRoute('Home')]);

      const result = sanitizeNavigationState(state);

      expect(result.index).toBe(state.index);
      expect(result.key).toBe(state.key);
      expect(result.routeNames).toEqual(state.routeNames);
      expect(result.type).toBe(state.type);
    });

    it('does not mutate the original state', () => {
      const originalParams = { url: 'https://secret.com' };
      const state = createNavigationState([createRoute('ShareCapture', { ...originalParams })]);
      const originalStateJson = JSON.stringify(state);

      sanitizeNavigationState(state);

      expect(JSON.stringify(state)).toBe(originalStateJson);
    });
  });

  describe('isValidNavigationState', () => {
    describe('returns true for valid states', () => {
      it('accepts a basic valid state', () => {
        const state = createNavigationState([createRoute('Home')]);
        expect(isValidNavigationState(state)).toBe(true);
      });

      it('accepts state with multiple routes', () => {
        const state = createNavigationState([
          createRoute('Home'),
          createRoute('Detail'),
          createRoute('Settings'),
        ]);
        expect(isValidNavigationState(state)).toBe(true);
      });

      it('accepts state with params', () => {
        const state = createNavigationState([createRoute('Detail', { id: '123' })]);
        expect(isValidNavigationState(state)).toBe(true);
      });

      it('accepts state with nested state', () => {
        const nested = createNavigationState([createRoute('NestedScreen')]);
        const state = createNavigationState([createRoute('Tab', {}, nested)]);
        expect(isValidNavigationState(state)).toBe(true);
      });
    });

    describe('returns false for invalid states', () => {
      it('rejects null', () => {
        expect(isValidNavigationState(null)).toBe(false);
      });

      it('rejects undefined', () => {
        expect(isValidNavigationState(undefined)).toBe(false);
      });

      it('rejects primitives', () => {
        expect(isValidNavigationState('string')).toBe(false);
        expect(isValidNavigationState(123)).toBe(false);
        expect(isValidNavigationState(true)).toBe(false);
      });

      it('rejects empty object', () => {
        expect(isValidNavigationState({})).toBe(false);
      });

      it('rejects object without routes', () => {
        expect(isValidNavigationState({ index: 0 })).toBe(false);
      });

      it('rejects non-array routes', () => {
        expect(isValidNavigationState({ routes: 'not-an-array' })).toBe(false);
        expect(isValidNavigationState({ routes: {} })).toBe(false);
      });

      it('rejects empty routes array', () => {
        expect(isValidNavigationState({ routes: [] })).toBe(false);
      });

      it('rejects routes without key property', () => {
        expect(
          isValidNavigationState({
            routes: [{ name: 'Home' }],
          })
        ).toBe(false);
      });

      it('rejects routes without name property', () => {
        expect(
          isValidNavigationState({
            routes: [{ key: 'home-key' }],
          })
        ).toBe(false);
      });

      it('rejects routes with non-string key', () => {
        expect(
          isValidNavigationState({
            routes: [{ key: 123, name: 'Home' }],
          })
        ).toBe(false);
      });

      it('rejects routes with non-string name', () => {
        expect(
          isValidNavigationState({
            routes: [{ key: 'home-key', name: 123 }],
          })
        ).toBe(false);
      });

      it('rejects if any route is invalid in array', () => {
        expect(
          isValidNavigationState({
            routes: [
              { key: 'home-key', name: 'Home' },
              { key: 'detail-key' }, // missing name
            ],
          })
        ).toBe(false);
      });

      it('rejects null routes in array', () => {
        expect(
          isValidNavigationState({
            routes: [null],
          })
        ).toBe(false);
      });
    });
  });

  describe('validatePersistedState', () => {
    const createPersistedState = (
      overrides: Partial<PersistedNavigationState> = {}
    ): PersistedNavigationState => ({
      state: createNavigationState([createRoute('Home')]),
      timestamp: Date.now(),
      version: NAVIGATION_STATE_VERSION,
      ...overrides,
    });

    describe('returns valid state when', () => {
      it('state is valid, current version, and not expired', () => {
        const persisted = createPersistedState();
        const result = validatePersistedState(persisted);
        expect(result).toEqual(persisted.state);
      });

      it('state is just under TTL limit', () => {
        const persisted = createPersistedState({
          timestamp: Date.now() - NAVIGATION_STATE_TTL_MS + 1000, // 1 second before expiry
        });
        const result = validatePersistedState(persisted);
        expect(result).toEqual(persisted.state);
      });
    });

    describe('returns null when', () => {
      it('persisted is null', () => {
        expect(validatePersistedState(null)).toBeNull();
      });

      it('version does not match current version', () => {
        const persisted = createPersistedState({ version: 0 });
        expect(validatePersistedState(persisted)).toBeNull();
      });

      it('version is higher than current (future version)', () => {
        const persisted = createPersistedState({ version: NAVIGATION_STATE_VERSION + 1 });
        expect(validatePersistedState(persisted)).toBeNull();
      });

      it('state is expired (exactly at TTL)', () => {
        const persisted = createPersistedState({
          timestamp: Date.now() - NAVIGATION_STATE_TTL_MS - 1,
        });
        expect(validatePersistedState(persisted)).toBeNull();
      });

      it('state is long expired (days old)', () => {
        const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
        const persisted = createPersistedState({ timestamp: threeDaysAgo });
        expect(validatePersistedState(persisted)).toBeNull();
      });

      it('state structure is invalid', () => {
        const persisted = createPersistedState({
          state: { routes: [] } as unknown as NavigationState, // Empty routes
        });
        expect(validatePersistedState(persisted)).toBeNull();
      });

      it('state is missing routes', () => {
        const persisted = createPersistedState({
          state: {} as unknown as NavigationState,
        });
        expect(validatePersistedState(persisted)).toBeNull();
      });
    });

    describe('TTL edge cases', () => {
      it('handles timestamp of 0 (very old)', () => {
        const persisted = createPersistedState({ timestamp: 0 });
        expect(validatePersistedState(persisted)).toBeNull();
      });

      it('handles negative timestamp', () => {
        const persisted = createPersistedState({ timestamp: -1000 });
        expect(validatePersistedState(persisted)).toBeNull();
      });

      it('handles future timestamp (still valid)', () => {
        const persisted = createPersistedState({
          timestamp: Date.now() + 1000, // 1 second in future
        });
        // Future timestamps result in negative age, which is < TTL, so valid
        expect(validatePersistedState(persisted)).toEqual(persisted.state);
      });
    });

    describe('version migration scenarios', () => {
      it('rejects version 0 (pre-versioning state)', () => {
        const persisted = createPersistedState({ version: 0 });
        expect(validatePersistedState(persisted)).toBeNull();
      });

      it('would accept matching version after increment', () => {
        // This test documents expected behavior if NAVIGATION_STATE_VERSION is incremented
        const currentVersion = NAVIGATION_STATE_VERSION;
        const persisted = createPersistedState({ version: currentVersion });
        expect(validatePersistedState(persisted)).not.toBeNull();
      });
    });
  });
});
